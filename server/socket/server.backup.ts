import { createServer } from "http";
import { Server } from "socket.io";

import {
  getInterviewState,
  transitionInterview,
  setCurrentQuestion,
} from "../interview/interview-engine";

import {
  getInitialQuestion,
  getNextQuestion,
  generateFollowUp,
} from "../ai/mock-interview";

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

type UserRole =
  | "CANDIDATE"
  | "INTERVIEWER"
  | "ADMIN";

type JoinRoomData = {
  roomId: string;
  name: string;
  role: UserRole;
};

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // =====================================================
  // JOIN INTERVIEW ROOM
  // =====================================================

  socket.on(
    "join-room",
    async (data: JoinRoomData) => {
      if (!data?.roomId) {
        return;
      }

      const {
        roomId,
        name,
        role,
      } = data;

      socket.data.name =
        name || "Participant";

      socket.data.role =
        role || "CANDIDATE";

      // Get existing participants BEFORE joining
      const room =
        io.sockets.adapter.rooms.get(roomId);

      const existingParticipants =
        room
          ? Array.from(room)
          : [];

      await socket.join(roomId);

      console.log(
        `Socket ${socket.id} joined room ${roomId}`
      );

      console.log(
        `Participant: ${socket.data.name} (${socket.data.role})`
      );

      console.log(
        "Existing participants:",
        existingParticipants
      );

      // Get updated room
      const updatedRoom =
        io.sockets.adapter.rooms.get(roomId);

      const participantCount =
        updatedRoom
          ? updatedRoom.size
          : 0;

      console.log(
        `Room ${roomId} now has ${participantCount} participant(s)`
      );

      // Tell everyone participant count
      io.to(roomId).emit(
        "room-participants",
        {
          count: participantCount,
        }
      );

      // Send current interview state
      const interviewState =
        getInterviewState(roomId);

      socket.emit(
        "interview:state",
        interviewState
      );

      // Tell NEW participant about existing peers
      for (
        const existingSocketId of existingParticipants
      ) {
        const existingSocket =
          io.sockets.sockets.get(
            existingSocketId
          );

        socket.emit(
          "existing-peer",
          {
            socketId:
              existingSocketId,

            name:
              existingSocket?.data?.name ??
              "Participant",

            role:
              existingSocket?.data?.role ??
              "CANDIDATE",
          }
        );
      }

      // Tell EXISTING participants
      // that someone joined
      socket.to(roomId).emit(
        "peer-joined",
        {
          socketId: socket.id,
          name: socket.data.name,
          role: socket.data.role,
        }
      );
    }
  );

  // =====================================================
  // START INTERVIEW
  // =====================================================

  socket.on(
    "interview:start",
    (roomId: string) => {
      if (!roomId) {
        return;
      }

      console.log(
        `Starting interview: ${roomId}`
      );

      // WAITING -> INTRODUCTION
      let state =
        transitionInterview(
          roomId,
          "START_INTERVIEW"
        );

      io.to(roomId).emit(
        "interview:state",
        state
      );

      // INTRODUCTION -> AI_TURN
      state =
        transitionInterview(
          roomId,
          "AI_START"
        );

      // Get first AI question
      const question =
        getInitialQuestion();

      // Store question
      state =
        setCurrentQuestion(
          roomId,
          question.question
        );

      // Send question
      io.to(roomId).emit(
        "ai:question",
        {
          question:
            question.question,
        }
      );

      // Send updated state
      io.to(roomId).emit(
        "interview:state",
        state
      );

      console.log(
        `AI question: ${question.question}`
      );

      
    }
  );

  // =====================================================
  // AI / HUMAN CONTROL
  // =====================================================

  socket.on(
    "ai-control",
    (data: {
      roomId: string;
      action:
        | "PAUSE"
        | "RESUME"
        | "NEXT_QUESTION"
        | "HUMAN_TAKEOVER"
        | "HUMAN_FINISHED"
        | "END_INTERVIEW";
    }) => {
      const {
        roomId,
        action,
      } = data;

      if (!roomId || !action) {
        return;
      }

      console.log(
        `AI control: ${action} | room: ${roomId}`
      );

      // -------------------------------------------------
      // NEXT QUESTION
      // -------------------------------------------------

      if (action === "NEXT_QUESTION") {
        let state =
          transitionInterview(
            roomId,
            "NEXT_QUESTION"
          );

        const question =
          getNextQuestion(
            state.questionNumber
          );

        state =
          setCurrentQuestion(
            roomId,
            question.question
          );

        io.to(roomId).emit(
          "ai:question",
          {
            question:
              question.question,
          }
        );

        io.to(roomId).emit(
          "interview:state",
          state
        );

        return;
      }

      // -------------------------------------------------
      // OTHER CONTROLS
      // -------------------------------------------------

      const eventMap = {
        PAUSE: "PAUSE_AI",
        RESUME: "RESUME_AI",
        HUMAN_TAKEOVER:
          "HUMAN_TAKEOVER",
        HUMAN_FINISHED:
          "HUMAN_FINISHED",
        END_INTERVIEW:
          "END_INTERVIEW",
      } as const;

      const event =
        eventMap[action];

      const state =
        transitionInterview(
          roomId,
          event
        );

      io.to(roomId).emit(
        "interview:state",
        state
      );
    }
  );

  // =====================================================
  // CANDIDATE ANSWER
  // =====================================================

  socket.on(
    "candidate:answer",
    (data: {
      roomId: string;
      text: string;
    }) => {
      if (
        !data?.roomId ||
        !data.text ||
        !data.text.trim()
      ) {
        return;
      }

      const answer =
        data.text.trim();

      console.log(
        `Candidate answer received | room: ${data.roomId}`
      );

      // Candidate answered
      let state =
        transitionInterview(
          data.roomId,
          "CANDIDATE_ANSWER"
        );

      // Send candidate answer
      // to everyone
      io.to(data.roomId).emit(
        "transcript:update",
        {
          speaker: "CANDIDATE",
          text: answer,
          timestamp:
            new Date().toISOString(),
        }
      );

      // Show THINKING state
      io.to(data.roomId).emit(
        "interview:state",
        state
      );

      // Simulate AI analysis
      setTimeout(() => {
        console.log(
          `AI analyzing answer | room: ${data.roomId}`
        );

        // Analysis complete
        state =
          transitionInterview(
            data.roomId,
            "AI_ANALYSIS_COMPLETE"
          );

        io.to(data.roomId).emit(
          "interview:state",
          state
        );

        // Generate contextual follow-up
        const followUp =
          generateFollowUp(answer);

        // AI follow-up state
        state =
          transitionInterview(
            data.roomId,
            "AI_FOLLOW_UP"
          );

        // Store new question
        state =
          setCurrentQuestion(
            data.roomId,
            followUp
          );

        // Send follow-up question
        io.to(data.roomId).emit(
          "ai:question",
          {
            question: followUp,
          }
        );

        // Send updated state
        io.to(data.roomId).emit(
          "interview:state",
          state
        );

        console.log(
          `AI follow-up: ${followUp}`
        );

        // AI finishes speaking
        setTimeout(() => {
          const listeningState =
            transitionInterview(
              data.roomId,
              "AI_FINISHED_SPEAKING"
            );

          io.to(data.roomId).emit(
            "interview:state",
            listeningState
          );
        }, 2000);
      }, 1500);
    }
  );

  // =====================================================
  // MANUAL AI QUESTION
  // =====================================================

  socket.on(
    "ai:question",
    (data: {
      roomId: string;
      question: string;
    }) => {
      if (
        !data?.roomId ||
        !data.question ||
        !data.question.trim()
      ) {
        return;
      }

      const state =
        setCurrentQuestion(
          data.roomId,
          data.question.trim()
        );

      io.to(data.roomId).emit(
        "ai:question",
        {
          question:
            data.question.trim(),
        }
      );

      io.to(data.roomId).emit(
        "interview:state",
        state
      );

      console.log(
        `AI question sent | room: ${data.roomId}`
      );
    }
  );

  // =====================================================
  // WEBRTC OFFER
  // =====================================================

  socket.on(
    "webrtc-offer",
    (data: {
      targetSocketId: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      const {
        targetSocketId,
        offer,
      } = data;

      if (!targetSocketId || !offer) {
        return;
      }

      console.log(
        `Relaying OFFER ${socket.id} → ${targetSocketId}`
      );

      io.to(targetSocketId).emit(
        "webrtc-offer",
        {
          offer,
          senderSocketId:
            socket.id,
        }
      );
    }
  );

  // =====================================================
  // WEBRTC ANSWER
  // =====================================================

  socket.on(
    "webrtc-answer",
    (data: {
      targetSocketId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      const {
        targetSocketId,
        answer,
      } = data;

      if (!targetSocketId || !answer) {
        return;
      }

      console.log(
        `Relaying ANSWER ${socket.id} → ${targetSocketId}`
      );

      io.to(targetSocketId).emit(
        "webrtc-answer",
        {
          answer,
          senderSocketId:
            socket.id,
        }
      );
    }
  );

  // =====================================================
  // WEBRTC ICE CANDIDATE
  // =====================================================

  socket.on(
    "webrtc-ice-candidate",
    (data: {
      targetSocketId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const {
        targetSocketId,
        candidate,
      } = data;

      if (!targetSocketId || !candidate) {
        return;
      }

      io.to(targetSocketId).emit(
        "webrtc-ice-candidate",
        {
          candidate,
          senderSocketId:
            socket.id,
        }
      );
    }
  );

  // =====================================================
  // CHAT MESSAGE
  // =====================================================

  socket.on(
    "chat-message",
    (data: {
      roomId: string;
      message: string;
      senderName?: string;
    }) => {
      if (
        !data?.roomId ||
        !data.message ||
        !data.message.trim()
      ) {
        return;
      }

      io.to(data.roomId).emit(
        "chat-message",
        {
          senderSocketId:
            socket.id,

          senderName:
            data.senderName ??
            socket.data.name ??
            "Participant",

          message:
            data.message.trim(),

          timestamp:
            new Date().toISOString(),
        }
      );
    }
  );

  // =====================================================
  // LEAVE ROOM
  // =====================================================

  socket.on(
    "leave-room",
    async (roomId: string) => {
      if (!roomId) {
        return;
      }

      await socket.leave(roomId);

      console.log(
        `Socket ${socket.id} left room ${roomId}`
      );

      io.to(roomId).emit(
        "peer-left",
        {
          socketId: socket.id,
        }
      );

      const room =
        io.sockets.adapter.rooms.get(
          roomId
        );

      const participantCount =
        room
          ? room.size
          : 0;

      io.to(roomId).emit(
        "room-participants",
        {
          count: participantCount,
        }
      );
    }
  );

  // =====================================================
  // DISCONNECT
  // =====================================================

  socket.on("disconnect", () => {
    console.log(
      `Socket disconnected: ${socket.id}`
    );
  });
});

// =========================================================
// START SOCKET.IO SERVER
// =========================================================

const PORT = Number(
  process.env.SOCKET_PORT ?? 3001
);

httpServer.listen(
  PORT,
  () => {
    console.log(
      `Socket.IO server running on http://localhost:${PORT}`
    );
  }
);