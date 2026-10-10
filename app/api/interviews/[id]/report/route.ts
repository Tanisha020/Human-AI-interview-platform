import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "You must be logged in." }, { status: 401 });
    }

    const { id } = await context.params;
    const report = await prisma.interviewReport.findUnique({
      where: { interviewId: id },
      include: {
        interview: {
          select: {
            createdById: true,
            title: true,
            jobTitle: true,
            status: true,
            answers: { select: { id: true } },
            evaluations: {
              where: { source: "AI" },
              include: { answer: { include: { question: { select: { type: true } } } } },
            },
          },
        },
      },
    });

    if (!report) {
      return NextResponse.json({ error: "The final report is not available yet." }, { status: 404 });
    }

    const isCandidate = report.candidateId === session.user.id;
    const isInterviewCreator = report.interview.createdById === session.user.id;
    const isAdmin = session.user.role === "ADMIN";

    if (!isCandidate && !isInterviewCreator && !isAdmin) {
      return NextResponse.json({ error: "You are not allowed to view this report." }, { status: 403 });
    }

    const aiEvaluations = report.interview.evaluations.filter(
      (evaluation) => evaluation.source === "AI" && evaluation.answerId,
    );
    const applicableScores = aiEvaluations.flatMap((evaluation) => {
      const scores = [
        evaluation.technicalKnowledge,
        evaluation.problemSolving,
        evaluation.communication,
        evaluation.relevance,
        evaluation.confidence,
        evaluation.jobSkills,
      ];
      // Behavioral is not relevant to technical answers; older records often
      // stored zero here and that should not lower the overall score.
      if (evaluation.answer?.question.type === "BEHAVIORAL") scores.push(evaluation.behavioral);
      return scores;
    });
    const overallScore = applicableScores.length
      ? Math.round((applicableScores.reduce((sum, score) => sum + score, 0) / applicableScores.length) * 10) / 10
      : null;
    const recommendation =
      overallScore === null ? "Not enough evaluated answers yet" :
      overallScore >= 8 ? "Strong performance" :
      overallScore >= 6.5 ? "Good progress — keep practicing" :
      overallScore >= 5 ? "Developing — focus on the improvement areas" :
      "Practice recommended — use the question-by-question feedback as a guide";
    const evaluatedAnswerCount = new Set(aiEvaluations.map((evaluation) => evaluation.answerId)).size;
    const summary = `Reviewed ${report.interview.answers.length} submitted answer(s). ${evaluatedAnswerCount} answer(s) received an AI evaluation. Behavioral scores are excluded for technical questions, and answers without an evaluation are not counted as zero.`;
    const reportFields = {
      id: report.id,
      interviewId: report.interviewId,
      candidateId: report.candidateId,
      strengths: report.strengths,
      weaknesses: report.weaknesses,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };

    return NextResponse.json({
      report: { ...reportFields, overallScore, recommendation, summary },
    });
  } catch (error) {
    console.error("Fetch interview report failed:", error);
    return NextResponse.json({ error: "Could not load the interview report." }, { status: 500 });
  }
}
