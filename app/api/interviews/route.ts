import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

const createInterviewSchema = z.object({
  title: z.string().trim().min(3),
  jobTitle: z.string().trim().min(2),
  jobDescription: z.string().trim().min(10),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  duration: z.number().int().min(15).max(180),
  scheduledAt: z.string().datetime({ offset: true }),
  candidateEmail: z.string().trim().email(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "You must be logged in." },
        { status: 401 }
      );
    }

    if (session.user.role !== "INTERVIEWER") {
      return NextResponse.json(
        { error: "Only interviewers can create interviews." },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const result = createInterviewSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Invalid interview data.",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const {
      title,
      jobTitle,
      jobDescription,
      difficulty,
      duration,
      scheduledAt,
      candidateEmail,
    } = result.data;

    // Require a timezone-aware ISO date so a server's timezone cannot shift
    // the interview time selected by the interviewer.
    const scheduledDate = new Date(scheduledAt);

    if (!Number.isFinite(scheduledDate.getTime())) {
      return NextResponse.json(
        {
          error: "Invalid interview date. Please select a valid date and time.",
        },
        { status: 400 }
      );
    }

    const candidate = await prisma.user.findUnique({
      where: {
        email: candidateEmail.toLowerCase(),
      },
    });

    if (!candidate) {
      return NextResponse.json(
        {
          error:
            "Candidate account not found. The candidate must register first.",
        },
        { status: 404 }
      );
    }

    if (candidate.role !== "CANDIDATE") {
      return NextResponse.json(
        {
          error: "The selected email does not belong to a candidate.",
        },
        { status: 400 }
      );
    }

    const interview = await prisma.interview.create({
      data: {
        title,
        jobTitle,
        jobDescription,
        difficulty,
        duration,
        scheduledAt: scheduledDate,
        status: "SCHEDULED",
        createdById: session.user.id,

        participants: {
          create: {
            userId: candidate.id,
            role: "CANDIDATE",
          },
        },
      },

      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Interview created successfully.",
        interview,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create interview error:", error);

    return NextResponse.json(
      {
        error: "Something went wrong while creating the interview.",
      },
      { status: 500 }
    );
  }
}
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "You must be logged in." },
        { status: 401 }
      );
    }

    if (session.user.role !== "INTERVIEWER") {
      return NextResponse.json(
        { error: "Only interviewers can view interviews." },
        { status: 403 }
      );
    }

    const interviews = await prisma.interview.findMany({
      where: {
        createdById: session.user.id,
      },
      orderBy: {
        scheduledAt: "asc",
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      interviews,
    });
  } catch (error) {
    console.error("Get interviews error:", error);

    return NextResponse.json(
      { error: "Something went wrong while fetching interviews." },
      { status: 500 }
    );
  }
}