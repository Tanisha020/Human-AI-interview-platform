import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  interviewPrisma?: PrismaClient;
};

const prisma =
  globalForPrisma.interviewPrisma ??
  new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.interviewPrisma = prisma;
}

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
): Promise<void> {
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
      return;
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
      return;
    }

    await prisma.answer.create({
      data: {
        interviewId,
        questionId: question.id,
        candidateId: participant.userId,
        answerText,
      },
    });
  } catch (error) {
    console.error("Could not persist candidate answer:", error);
  }
}
