import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

const evaluationSchema = z.object({
  technicalKnowledge: z.number().int().min(0).max(10),
  problemSolving: z.number().int().min(0).max(10),
  communication: z.number().int().min(0).max(10),
  relevance: z.number().int().min(0).max(10),
  confidence: z.number().int().min(0).max(10),
  behavioral: z.number().int().min(0).max(10),
  jobSkills: z.number().int().min(0).max(10),
  strengths: z.string().trim().max(3000).optional().default(""),
  weaknesses: z.string().trim().max(3000).optional().default(""),
  feedback: z.string().trim().max(5000).optional().default(""),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "You must be logged in." }, { status: 401 });
    }
    if (session.user.role !== "INTERVIEWER" && session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only interviewers can submit human evaluations." }, { status: 403 });
    }

    const { id: interviewId } = await context.params;
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: { id: true, createdById: true, status: true },
    });

    if (!interview) {
      return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    }
    if (session.user.role !== "ADMIN" && interview.createdById !== session.user.id) {
      return NextResponse.json({ error: "You do not own this interview." }, { status: 403 });
    }
    if (interview.status !== "COMPLETED") {
      return NextResponse.json({ error: "End the interview before submitting the final human evaluation." }, { status: 409 });
    }

    const parsed = evaluationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid evaluation data.", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const evaluation = await prisma.evaluation.create({
      data: {
        interviewId,
        evaluatorId: session.user.id,
        source: "HUMAN",
        ...parsed.data,
      },
    });

    return NextResponse.json({ message: "Human evaluation saved.", evaluation }, { status: 201 });
  } catch (error) {
    console.error("Save human evaluation failed:", error);
    return NextResponse.json({ error: "Could not save the human evaluation." }, { status: 500 });
  }
}
