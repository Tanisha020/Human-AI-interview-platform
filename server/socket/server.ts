import { createServer } from "http";
import { Server } from "socket.io";

import { generateAIQuestion, analyzeCandidateAnswer } from "../ai/ai-service";

import type { InterviewContext } from "../ai/ai-provider";

import {
  getInterviewState,
  transitionInterview,
  setCurrentQuestion,
} from "../interview/interview-engine";

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// =========================================================
// TYPES
// =========================================================

type UserRole = "CANDIDATE" | "INTERVIEWER" | "ADMIN";

type JoinRoomData = {
  roomId: string;
  name: string;
  role: UserRole;
};

type ConversationMessage = {
  speaker: "AI" | "CANDIDATE" | "HUMAN";
  text: string;
};

// =========================================================
// AI CONVERSATION MEMORY
// =========================================================

const interviewConversations = new Map<string, ConversationMessage[]>();

function getConversation(roomId: string): ConversationMessage[] {
  if (!interviewConversations.has(roomId)) {
    interviewConversations.set(roomId, []);
  }

  return interviewConversations.get(roomId)!;
}

function addConversationMessage(roomId: string, message: ConversationMessage) {
  const conversation = getConversation(roomId);

  conversation.push(message);

  // Keep only the latest 20 messages.
  // This prevents the prompt from growing forever.
  if (conversation.length > 20) {
    conversation.splice(0, conversation.length - 20);
  }
}

// =========================================================
// AI CONTEXT
// =========================================================

function buildAIContext(roomId: string): InterviewContext {
  const state = getInterviewState(roomId);
  const conversation = getConversation(roomId);

  return {
    jobTitle: "Software Engineer",

    jobDescription:
      "Software engineering role involving programming, data structures, algorithms, problem solving, software development and computer science fundamentals.",

    difficulty: "MEDIUM",

    questionNumber: state.questionNumber || 1,

    currentQuestion: state.currentQuestion,

    conversation,
  };
}

// =========================================================
// GENERATE AI QUESTION
// =========================================================

async function generateAndSendAIQuestion(roomId: string) {
  try {
    console.log(`Generating real AI question | room: ${roomId}`);

    const context = buildAIContext(roomId);

    const question = await generateAIQuestion(context);

    if (!question.question?.trim()) {
      throw new Error("AI returned an empty question.");
    }

    let state = setCurrentQuestion(roomId, question.question.trim());

    addConversationMessage(roomId, {
      speaker: "AI",
      text: question.question.trim(),
    });

    io.to(roomId).emit("ai:question", {
      question: question.question.trim(),
    });

    io.to(roomId).emit("interview:state", state);

    console.log(`REAL AI question: ${question.question}`);

    return question;
  } catch (error) {
    console.error("Real AI question generation failed:", error);

    io.to(roomId).emit("ai:error", {
      message:
        "The AI interviewer could not generate a question. Please make sure Ollama is running.",
    });

    return null;
  }
}

// =========================================================
// SOCKET CONNECTION
// =========================================================

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // =======================================================
  // JOIN INTERVIEW ROOM
  // =======================================================

  socket.on("join-room", async (data: JoinRoomData) => {
    if (!data?.roomId) {
      return;
    }

    const { roomId, name, role } = data;

    socket.data.name = name || "Participant";

    socket.data.role = role || "CANDIDATE";

    // Get existing participants BEFORE joining
    const room = io.sockets.adapter.rooms.get(roomId);

    const existingParticipants = room ? Array.from(room) : [];

    await socket.join(roomId);

    console.log(`Socket ${socket.id} joined room ${roomId}`);

    console.log(`Participant: ${socket.data.name} (${socket.data.role})`);

    // Get updated room
    const updatedRoom = io.sockets.adapter.rooms.get(roomId);

    const participantCount = updatedRoom ? updatedRoom.size : 0;

    console.log(`Room ${roomId} now has ${participantCount} participant(s)`);

    io.to(roomId).emit("room-participants", {
      count: participantCount,
    });

    // Send current interview state
    const interviewState = getInterviewState(roomId);

    socket.emit("interview:state", interviewState);

    // Tell NEW participant about existing peers
    for (const existingSocketId of existingParticipants) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);

      socket.emit("existing-peer", {
        socketId: existingSocketId,

        name: existingSocket?.data?.name ?? "Participant",

        role: existingSocket?.data?.role ?? "CANDIDATE",
      });
    }

    // Tell EXISTING participants
    socket.to(roomId).emit("peer-joined", {
      socketId: socket.id,
      name: socket.data.name,
      role: socket.data.role,
    });
  });

  // =======================================================
  // START INTERVIEW
  // =======================================================

  socket.on("interview:start", async (roomId: string) => {
    if (!roomId) {
      return;
    }

    console.log(`Starting REAL AI interview: ${roomId}`);

    try {
      // WAITING -> INTRODUCTION
      let state = transitionInterview(roomId, "START_INTERVIEW");

      io.to(roomId).emit("interview:state", state);

      // INTRODUCTION -> AI_TURN
      state = transitionInterview(roomId, "AI_START");

      io.to(roomId).emit("interview:state", state);

      // Reset conversation for this interview
      interviewConversations.set(roomId, []);

      // Start with a fixed introduction question.
      // Do not let the AI jump directly into projects or technical questions.
      const openingQuestion =
        "Hello, welcome to your interview. To begin, could you briefly introduce yourself and walk me through your background?";

      interviewConversations.set(roomId, []);

      state = setCurrentQuestion(roomId, openingQuestion);

      addConversationMessage(roomId, {
        speaker: "AI",
        text: openingQuestion,
      });

      io.to(roomId).emit("ai:question", {
        question: openingQuestion,
      });

      io.to(roomId).emit("interview:state", state);

      console.log(`Opening introduction question sent | room: ${roomId}`);
    } catch (error) {
      console.error("Interview start failed:", error);

      io.to(roomId).emit("ai:error", {
        message: "Unable to start the AI interview.",
      });
    }
  });

  // =======================================================
  // AI / HUMAN CONTROL
  // =======================================================

  socket.on(
    "ai-control",
    async (data: {
      roomId: string;
      action:
        | "PAUSE"
        | "RESUME"
        | "NEXT_QUESTION"
        | "HUMAN_TAKEOVER"
        | "HUMAN_FINISHED"
        | "END_INTERVIEW";
    }) => {
      const { roomId, action } = data;

      if (!roomId || !action) {
        return;
      }

      console.log(`AI control: ${action} | room: ${roomId}`);

      // ---------------------------------------------------
      // NEXT QUESTION
      // ---------------------------------------------------

      if (action === "NEXT_QUESTION") {
        try {
          const state = transitionInterview(roomId, "NEXT_QUESTION");

          io.to(roomId).emit("interview:state", state);

          await generateAndSendAIQuestion(roomId);
        } catch (error) {
          console.error("Next AI question failed:", error);
        }

        return;
      }

      // ---------------------------------------------------
      // OTHER CONTROLS
      // ---------------------------------------------------

      const eventMap = {
        PAUSE: "PAUSE_AI",
        RESUME: "RESUME_AI",
        HUMAN_TAKEOVER: "HUMAN_TAKEOVER",
        HUMAN_FINISHED: "HUMAN_FINISHED",
        END_INTERVIEW: "END_INTERVIEW",
      } as const;

      const event = eventMap[action];

      const state = transitionInterview(roomId, event);

      io.to(roomId).emit("interview:state", state);
    },
  );

// =======================================================
// LIVE SPEAKER-LABELLED TRANSCRIPTION
// =======================================================

socket.on(
  "transcript:segment",
  (data: {
    roomId: string;
    text: string;
  }) => {
    if (
      !data?.roomId ||
      typeof data.text !== "string" ||
      !data.text.trim()
    ) {
      return;
    }

    const roomId = data.roomId;
    const text = data.text.trim();

    // Accept transcript events only from a socket
    // that has joined the specified room.
    if (!socket.rooms.has(roomId)) {
      return;
    }

    // Map the participant role to a transcript speaker.
    const role = socket.data.role;

    let speaker: "CANDIDATE" | "HUMAN";

    if (role === "CANDIDATE") {
      speaker = "CANDIDATE";
    } else if (
      role === "INTERVIEWER" ||
      role === "ADMIN"
    ) {
      speaker = "HUMAN";
    } else {
      return;
    }

    const timestamp = new Date().toISOString();

    // Store the speech in the AI conversation memory.
    addConversationMessage(roomId, {
      speaker,
      text,
    });

    // Share the transcript with all participants.
    io.to(roomId).emit("transcript:update", {
      speaker,
      text,
      timestamp,
    });

    console.log(
      `Transcript received | ${speaker} | room: ${roomId}`
    );
  }
);

  // =======================================================
  // CANDIDATE ANSWER
  // =======================================================

  socket.on(
    "candidate:answer",
    async (data: { roomId: string; text: string }) => {
      if (!data?.roomId || !data.text || !data.text.trim()) {
        return;
      }

      const roomId = data.roomId;
      const answer = data.text.trim();

      console.log(`Candidate answer received | room: ${roomId}`);

      try {
        // Candidate answered
        let state = transitionInterview(roomId, "CANDIDATE_ANSWER");

        // Store candidate answer
        addConversationMessage(roomId, {
          speaker: "CANDIDATE",
          text: answer,
        });

        // Send candidate answer
        // to everyone
        io.to(roomId).emit("transcript:update", {
          speaker: "CANDIDATE",
          text: answer,
          timestamp: new Date().toISOString(),
        });

        // Show THINKING state
        io.to(roomId).emit("interview:state", state);

        console.log(`AI analyzing answer with Ollama | room: ${roomId}`);

        // Build context BEFORE analysis
        const context = buildAIContext(roomId);

        // REAL AI ANALYSIS
        const analysis = await analyzeCandidateAnswer(context, answer);

        console.log(`AI score: ${analysis.score}/10`);

        console.log(`AI feedback: ${analysis.feedback}`);

        // Analysis complete
        state = transitionInterview(roomId, "AI_ANALYSIS_COMPLETE");

        io.to(roomId).emit("interview:state", state);

        // Send evaluation to frontend
        io.to(roomId).emit("ai:evaluation", {
          score: analysis.score,
          strengths: analysis.strengths,
          weaknesses: analysis.weaknesses,
          feedback: analysis.feedback,
        });

        // -------------------------------------------------
        // FOLLOW-UP
        // -------------------------------------------------

        if (analysis.shouldFollowUp && analysis.followUpQuestion) {
          const followUp = analysis.followUpQuestion.trim();

          state = transitionInterview(roomId, "AI_FOLLOW_UP");

          state = setCurrentQuestion(roomId, followUp);

          addConversationMessage(roomId, {
            speaker: "AI",
            text: followUp,
          });

          io.to(roomId).emit("ai:question", {
            question: followUp,
          });

          io.to(roomId).emit("interview:state", state);

          console.log(`REAL AI follow-up: ${followUp}`);
        } else {
          // -------------------------------------------------
          // NO FOLLOW-UP
          // Generate the next independent question
          // -------------------------------------------------

          console.log("Answer complete. Generating next AI question.");

          await generateAndSendAIQuestion(roomId);
        }
      } catch (error) {
        console.error("AI answer analysis failed:", error);

        io.to(roomId).emit("ai:error", {
          message:
            "The AI could not analyze the answer. Please make sure Ollama is running.",
        });

        // Try to recover interview state
        try {
          const recoveryState = transitionInterview(
            roomId,
            "AI_ANALYSIS_COMPLETE",
          );

          io.to(roomId).emit("interview:state", recoveryState);
        } catch {
          // Ignore recovery failure
        }
      }
    },
  );

  // =======================================================
  // MANUAL AI QUESTION
  // =======================================================

  socket.on(
    "ai:question",
    async (data: { roomId: string; question: string }) => {
      if (!data?.roomId || !data.question || !data.question.trim()) {
        return;
      }

      const question = data.question.trim();

      const state = setCurrentQuestion(data.roomId, question);

      addConversationMessage(data.roomId, {
        speaker: "AI",
        text: question,
      });

      io.to(data.roomId).emit("ai:question", {
        question,
      });

      io.to(data.roomId).emit("interview:state", state);

      console.log(`AI question sent | room: ${data.roomId}`);
    },
  );

  // =======================================================
  // WEBRTC OFFER
  // =======================================================

  socket.on(
    "webrtc-offer",
    (data: { targetSocketId: string; offer: RTCSessionDescriptionInit }) => {
      const { targetSocketId, offer } = data;

      if (!targetSocketId || !offer) {
        return;
      }

      console.log(`Relaying OFFER ${socket.id} → ${targetSocketId}`);

      io.to(targetSocketId).emit("webrtc-offer", {
        offer,
        senderSocketId: socket.id,
      });
    },
  );

  // =======================================================
  // WEBRTC ANSWER
  // =======================================================

  socket.on(
    "webrtc-answer",
    (data: { targetSocketId: string; answer: RTCSessionDescriptionInit }) => {
      const { targetSocketId, answer } = data;

      if (!targetSocketId || !answer) {
        return;
      }

      console.log(`Relaying ANSWER ${socket.id} → ${targetSocketId}`);

      io.to(targetSocketId).emit("webrtc-answer", {
        answer,
        senderSocketId: socket.id,
      });
    },
  );

  // =======================================================
  // WEBRTC ICE CANDIDATE
  // =======================================================

  socket.on(
    "webrtc-ice-candidate",
    (data: { targetSocketId: string; candidate: RTCIceCandidateInit }) => {
      const { targetSocketId, candidate } = data;

      if (!targetSocketId || !candidate) {
        return;
      }

      io.to(targetSocketId).emit("webrtc-ice-candidate", {
        candidate,
        senderSocketId: socket.id,
      });
    },
  );

  // =======================================================
  // CHAT MESSAGE
  // =======================================================

  socket.on(
    "chat-message",
    (data: { roomId: string; message: string; senderName?: string }) => {
      if (!data?.roomId || !data.message || !data.message.trim()) {
        return;
      }

      io.to(data.roomId).emit("chat-message", {
        senderSocketId: socket.id,

        senderName: data.senderName ?? socket.data.name ?? "Participant",

        message: data.message.trim(),

        timestamp: new Date().toISOString(),
      });
    },
  );

  // =======================================================
  // LEAVE ROOM
  // =======================================================

  socket.on("leave-room", async (roomId: string) => {
    if (!roomId) {
      return;
    }

    await socket.leave(roomId);

    console.log(`Socket ${socket.id} left room ${roomId}`);

    io.to(roomId).emit("peer-left", {
      socketId: socket.id,
    });

    const room = io.sockets.adapter.rooms.get(roomId);

    const participantCount = room ? room.size : 0;

    io.to(roomId).emit("room-participants", {
      count: participantCount,
    });

    // Clean AI memory when nobody remains
    if (participantCount === 0) {
      interviewConversations.delete(roomId);
    }
  });

  // =======================================================
  // DISCONNECT
  // =======================================================

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// =========================================================
// START SOCKET.IO SERVER
// =========================================================

const PORT = Number(process.env.SOCKET_PORT ?? 3001);

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on http://localhost:${PORT}`);
});
