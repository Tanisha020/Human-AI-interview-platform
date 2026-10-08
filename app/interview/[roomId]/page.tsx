import { connection } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import {
  notFound,
  redirect,
} from "next/navigation";

import WebRTCPanel from "@/components/interview/WebRTCPanel";

export const instant = false;

type InterviewRoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function InterviewRoomPage({
  params,
}: InterviewRoomPageProps) {
  await connection();

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { roomId } = await params;

  const interview =
    await prisma.interview.findUnique({
      where: {
        id: roomId,
      },
      include: {
        participants: {
          include: {
            user: true,
          },
        },
      },
    });

  if (!interview) {
    notFound();
  }

  const isAdmin =
    session.user.role === "ADMIN";

  const isCreator =
    interview.createdById ===
    session.user.id;

  const isParticipant =
    interview.participants.some(
      (participant) =>
        participant.userId ===
        session.user.id
    );

  if (
    !isAdmin &&
    !isCreator &&
    !isParticipant
  ) {
    redirect("/dashboard");
  }

  const userRole =
    session.user.role === "ADMIN"
      ? "ADMIN"
      : session.user.role === "INTERVIEWER"
      ? "INTERVIEWER"
      : "CANDIDATE";

  const userName =
    session.user.name ||
    "Participant";

  return (
    <div className="min-h-screen bg-[#070b14]">
      <WebRTCPanel
        roomId={interview.id}
        userName={userName}
        userRole={userRole}
      />
    </div>
  );
}