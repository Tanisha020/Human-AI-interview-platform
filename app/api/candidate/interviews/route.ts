import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "You must be logged in." },
        { status: 401 }
      );
    }

    if (session.user.role !== "CANDIDATE") {
      return NextResponse.json(
        { error: "Only candidates can access this endpoint." },
        { status: 403 }
      );
    }

    const interviews = await prisma.interview.findMany({
      where: {
        participants: {
          some: {
            userId: session.user.id,
            role: "CANDIDATE",
          },
        },
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
    console.error("Get candidate interviews error:", error);

    return NextResponse.json(
      { error: "Something went wrong while fetching interviews." },
      { status: 500 }
    );
  }
}