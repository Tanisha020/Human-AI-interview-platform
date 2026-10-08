"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket/client";

type InterviewRoomClientProps = {
  roomId: string;
  userName: string;
  userRole: "CANDIDATE" | "INTERVIEWER" | "ADMIN";
};

export default function InterviewRoomClient({
  roomId,
  userName,
  userRole,
}: InterviewRoomClientProps) {
  const [connected, setConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);

  useEffect(() => {
    const socket: Socket = getSocket();

    function handleConnect() {
      console.log("Connected to Socket.IO:", socket.id);

      setConnected(true);

      socket.emit("join-room", roomId);
    }

    function handleDisconnect() {
      console.log("Disconnected from Socket.IO");

      setConnected(false);
      setParticipantCount(0);
    }

    function handleRoomParticipants(data: { count: number }) {
      console.log("Room participant count:", data.count);

      setParticipantCount(data.count);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room-participants", handleRoomParticipants);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.emit("leave-room", roomId);

      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room-participants", handleRoomParticipants);
    };
  }, [roomId]);

  const otherParticipantConnected = participantCount >= 2;

  return (
    <div className="space-y-4">
      {/* Socket.IO connection */}
      <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">
            Real-time Connection
          </span>

          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              connected
                ? "bg-green-500/10 text-green-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Logged in as {userName} ({userRole})
        </p>
      </div>

      {/* Participant status */}
      <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-300">
            Participant Status
          </p>

          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              otherParticipantConnected
                ? "bg-green-500/10 text-green-400"
                : "bg-yellow-500/10 text-yellow-400"
            }`}
          >
            {participantCount}/2
          </span>
        </div>

        <p className="mt-2 text-sm text-slate-500">
          {otherParticipantConnected
            ? "Another participant is connected to this interview."
            : "Waiting for another participant to join..."}
        </p>
      </div>
    </div>
  );
}