import { prisma } from "../../lib/db/prisma";
import type { AIAnswerAnalysis } from "../ai/ai-provider";

type TranscriptSpeaker = "AI" | "CANDIDATE" | "HUMAN";
type QuestionCategory =
  | "INTRODUCTION"
  | "TECHNICAL"
  | "BEHAVIORAL"
  | "FOLLOW_UP"
  | "PROBLEM_SOLVING";

function toQuestionType(type?: string) {
  if (type === "BEHAVIORAL") return "BEHAVIORAL" as const;
  if (type === "PROBLEM_SOLVING") return "PROBLEM_SOLVING" as const;
  if (type === "INTRODUCTION") return "GENERAL" as const;
  return "TECHNICAL" as const;
}

export async function persistInterviewStatus(
  interviewId: string,
  status: "LIVE" | "COMPLETED"
): Promise<void> {
  try {
    await prisma.interview.update({
      where: { id: interviewId },
      data: { status },
    });
  } catch (error) {
    console.error("Could not persist interview status:", error);
  }
}

export async function persistQuestion(
  interviewId: string,
  questionText: string,
  type?: QuestionCategory
): Promise<string | null> {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: { id: true, difficulty: true },
    });

    if (!interview) {
      console.warn("Question not persisted: interview not found.", interviewId);
      return null;
    }

    const existing = await prisma.question.findFirst({
      where: {
        interviewId,
        question: questionText,
      },
      select: { id: true },
    });

    if (existing) return existing.id;

    const orderIndex = await prisma.question.count({
      where: { interviewId },
    });

    const question = await prisma.question.create({
      data: {
        interviewId,
        question: questionText,
        type: toQuestionType(type),
        difficulty: interview.difficulty,
        orderIndex: orderIndex + 1,
      },
      select: { id: true },
    });

    return question.id;
  } catch (error) {
    console.error("Could not persist interview question:", error);
    return null;
  }
}

export async function persistTranscriptSegment(
  interviewId: string,
  speaker: TranscriptSpeaker,
  text: string
): Promise<void> {
  try {
    await prisma.transcript.create({
      data: {
        interviewId,
        speakerId: null,
        type: "FINAL",
        text: `[${speaker}] ${text}`,
      },
    });
  } catch (error) {
    console.error("Could not persist transcript segment:", error);
  }
}

export async function persistCandidateAnswer(
  interviewId: string,
  answerText: string,
  currentQuestion: string | null
): Promise<string | null> {
  try {
    const participant = await prisma.participant.findFirst({
      where: {
        interviewId,
        role: "CANDIDATE",
      },
      select: { userId: true },
    });

    if (!participant) {
      console.warn("Answer not persisted: no candidate participant found.", interviewId);
      return null;
    }

    let question = currentQuestion
      ? await prisma.question.findFirst({
          where: { interviewId, question: currentQuestion },
          orderBy: { orderIndex: "desc" },
          select: { id: true },
        })
      : null;

    if (!question) {
      question = await prisma.question.findFirst({
        where: { interviewId },
        orderBy: { orderIndex: "desc" },
        select: { id: true },
      });
    }

    if (!question) {
      console.warn("Answer not persisted: no question record found.", interviewId);
      return null;
    }

    const answer = await prisma.answer.create({
      data: {
        interviewId,
        questionId: question.id,
        candidateId: participant.userId,
        answerText,
      },
      select: { id: true },
    });
    return answer.id;
  } catch (error) {
    console.error("Could not persist candidate answer:", error);
    return null;
  }
}

function scoreOrFallback(value: unknown, fallback: number): number {
  const score = Number(value);
  if (!Number.isFinite(score)) return Math.max(0, Math.min(10, Math.round(fallback)));
  return Math.max(0, Math.min(10, Math.round(score)));
}

export async function persistAIEvaluation(
  interviewId: string,
  answerId: string | null,
  analysis: AIAnswerAnalysis,
): Promise<void> {
  if (!answerId) return;

  try {
    const fallback = scoreOrFallback(analysis.score, 0);
    await prisma.evaluation.create({
      data: {
        interviewId,
        answerId,
        source: "AI",
        technicalKnowledge: scoreOrFallback(analysis.technicalKnowledge, fallback),
        problemSolving: scoreOrFallback(analysis.problemSolving, fallback),
        communication: scoreOrFallback(analysis.communication, fallback),
        relevance: scoreOrFallback(analysis.relevance, fallback),
        confidence: scoreOrFallback(analysis.confidence, fallback),
        behavioral: scoreOrFallback(analysis.behavioral, fallback),
        jobSkills: scoreOrFallback(analysis.jobSkills, fallback),
        strengths: Array.isArray(analysis.strengths) ? analysis.strengths.join("\n") : "",
        weaknesses: Array.isArray(analysis.weaknesses) ? analysis.weaknesses.join("\n") : "",
        feedback: analysis.feedback || "",
      },
    });
  } catch (error) {
    console.error("Could not persist AI evaluation:", error);
  }
}

export async function persistFinalInterviewReport(interviewId: string): Promise<void> {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        participants: { where: { role: "CANDIDATE" }, select: { userId: true } },
        answers: true,
        evaluations: true,
      },
    });

    const candidateId = interview?.participants[0]?.userId;
    if (!interview || !candidateId) {
      console.warn("Final report not created: interview or candidate missing.", interviewId);
      return;
    }

    const evaluations = interview.evaluations;
    const dimensionValues = evaluations.flatMap((evaluation) => [
      evaluation.technicalKnowledge,
      evaluation.problemSolving,
      evaluation.communication,
      evaluation.relevance,
      evaluation.confidence,
      evaluation.behavioral,
      evaluation.jobSkills,
    ]);
    const overallScore = dimensionValues.length
      ? Math.round((dimensionValues.reduce((sum, score) => sum + score, 0) / dimensionValues.length) * 10) / 10
      : null;

    const uniqueLines = (values: (string | null)[]) =>
      [...new Set(values.flatMap((value) => (value || "").split("\n").map((line) => line.trim()).filter(Boolean)))];
    const strengths = uniqueLines(evaluations.map((evaluation) => evaluation.strengths)).slice(0, 8).join("\n");
    const weaknesses = uniqueLines(evaluations.map((evaluation) => evaluation.weaknesses)).slice(0, 8).join("\n");
    const feedback = evaluations.map((evaluation) => evaluation.feedback).filter(Boolean).slice(-5).join("\n");

    const recommendation =
      overallScore === null ? "Insufficient evaluation data" :
      overallScore >= 8 ? "Strong performance" :
      overallScore >= 6 ? "Promising; review improvement areas" :
      overallScore >= 4 ? "Needs further review" :
      "Significant improvement needed";

    await prisma.interviewReport.upsert({
      where: { interviewId },
      create: {
        interviewId,
        candidateId,
        overallScore,
        summary: `Interview completed with ${interview.answers.length} submitted answer(s) and ${evaluations.length} evaluation(s). ${feedback}`.trim(),
        strengths: strengths || null,
        weaknesses: weaknesses || null,
        recommendation,
      },
      update: {
        candidateId,
        overallScore,
        summary: `Interview completed with ${interview.answers.length} submitted answer(s) and ${evaluations.length} evaluation(s). ${feedback}`.trim(),
        strengths: strengths || null,
        weaknesses: weaknesses || null,
        recommendation,
      },
    });
  } catch (error) {
    console.error("Could not persist final interview report:", error);
  }
}
