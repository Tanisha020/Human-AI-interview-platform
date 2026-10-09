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
          select: { createdById: true, title: true, jobTitle: true, status: true },
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

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Fetch interview report failed:", error);
    return NextResponse.json({ error: "Could not load the interview report." }, { status: 500 });
  }
}
