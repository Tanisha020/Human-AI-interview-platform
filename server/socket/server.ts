import "dotenv/config";
import { createServer } from "http";
import { Server } from "socket.io";
import { prisma } from "../../lib/db/prisma";
import { verifySocketTicket } from "../../lib/socket-ticket";

import { generateAIQuestion, analyzeCandidateAnswer } from "../ai/ai-service";

import type { InterviewContext } from "../ai/ai-provider";
import {
  persistAIEvaluation,
  persistCandidateAnswer,
  persistFinalInterviewReport,
  persistInterviewStatus,
  persistQuestion,
  persistTranscriptSegment,
} from "../persistence/interview-persistence";

import {
  getInterviewState,
  transitionInterview,
  setCurrentQuestion,
} from "../interview/interview-engine";

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// =========================================================
// TYPES
// =========================================================

type UserRole = "CANDIDATE" | "INTERVIEWER" | "ADMIN";

type JoinRoomData = {
  roomId: string;
  name?: string;
  role?: UserRole;
  socketTicket?: string;
};

type ConversationMessage = {
  speaker: "AI" | "CANDIDATE" | "HUMAN";
  text: string;
};

// =========================================================
// AI CONVERSATION MEMORY
// =========================================================

const interviewConversations = new Map<string, ConversationMessage[]>();
const questionGenerationVersion = new Map<string, number>();
const followUpQuestionTexts = new Map<string, Set<string>>();

function hasAskedFollowUp(roomId: string, question: string): boolean {
  return followUpQuestionTexts.get(roomId)?.has(question) ?? false;
}

function markFollowUp(roomId: string, question: string): void {
  const questions = followUpQuestionTexts.get(roomId) ?? new Set<string>();
  questions.add(question);
  followUpQuestionTexts.set(roomId, questions);
}

function invalidatePendingQuestion(roomId: string) {
  questionGenerationVersion.set(
    roomId,
    (questionGenerationVersion.get(roomId) ?? 0) + 1,
  );
}

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

/**
 * Live speech recognition sends candidate transcript segments before the
 * candidate presses Submit. If such segments exist after the most recent AI
 * question, do not add the submitted answer to the transcript a second time.
 * The submitted answer is still passed in full to the AI evaluator.
 */
function hasCandidateTranscriptSinceLastAI(roomId: string): boolean {
  const conversation = getConversation(roomId);

  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];

    if (message.speaker === "AI") {
      return false;
    }

    if (message.speaker === "CANDIDATE") {
      return true;
    }
  }

  return false;
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
  const generationVersion = questionGenerationVersion.get(roomId) ?? 0;

  try {
    console.log(`Generating real AI question | room: ${roomId}`);

    const context = buildAIContext(roomId);
    const question = await generateAIQuestion(context);

    // A reset, human takeover, or end-interview action invalidates this
    // request. Never let a slow model response overwrite the newer state.
    const latestState = getInterviewState(roomId);
    if (
      generationVersion !== (questionGenerationVersion.get(roomId) ?? 0) ||
      latestState.state === "COMPLETED" ||
      latestState.state === "HUMAN_TURN" ||
      latestState.state === "PAUSED_BY_HUMAN" ||
      latestState.aiPausedByHuman
    ) {
      return null;
    }

    if (!question.question?.trim()) {
      throw new Error("AI returned an empty question.");
    }

    const questionText = question.question.trim();
    await persistQuestion(roomId, questionText, question.type);

    const stateAfterPersistence = getInterviewState(roomId);
    if (
      generationVersion !== (questionGenerationVersion.get(roomId) ?? 0) ||
      stateAfterPersistence.state === "COMPLETED" ||
      stateAfterPersistence.state === "HUMAN_TURN" ||
      stateAfterPersistence.state === "PAUSED_BY_HUMAN" ||
      stateAfterPersistence.aiPausedByHuman
    ) {
      return null;
    }

    const state = setCurrentQuestion(roomId, questionText);

    addConversationMessage(roomId, {
      speaker: "AI",
      text: questionText,
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
    if (!data?.roomId || !data.socketTicket) {
      socket.emit("ai:error", { message: "Missing room authentication. Refresh the interview page." });
      return;
    }

    const claims = verifySocketTicket(data.socketTicket);
    if (!claims || claims.roomId !== data.roomId) {
      socket.emit("ai:error", { message: "Room authentication expired or invalid. Refresh the interview page." });
      return;
    }

    const [user, interview] = await Promise.all([
      prisma.user.findUnique({
        where: { id: claims.userId },
        select: { id: true, name: true, role: true },
      }),
      prisma.interview.findUnique({
        where: { id: data.roomId },
        select: {
          createdById: true,
          participants: { select: { userId: true, role: true } },
        },
      }),
    ]);

    if (!user || !interview || user.role !== claims.role) {
      socket.emit("ai:error", { message: "Your account or interview access could not be verified." });
      return;
    }

    const isCreator = interview.createdById === user.id;
    const isAssignedCandidate = interview.participants.some(
      (participant) => participant.userId === user.id && participant.role === "CANDIDATE",
    );
    const hasRoomAccess =
      user.role === "ADMIN" ||
      (user.role === "INTERVIEWER" && isCreator) ||
      (user.role === "CANDIDATE" && isAssignedCandidate);

    if (!hasRoomAccess) {
      socket.emit("ai:error", { message: "You are not authorized to join this interview room." });
      return;
    }

    const { roomId } = data;
    socket.data.userId = user.id;
    socket.data.name = user.name || "Participant";
    socket.data.role = user.role;

    // Get existing participants BEFORE joining
    const room = io.sockets.adapter.rooms.get(roomId);

    const existingParticipants = room ? Array.from(room) : [];

    await socket.join(roomId);
    socket.emit("room:joined", { roomId });

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

    if (
      !socket.rooms.has(roomId) ||
      (socket.data.role !== "INTERVIEWER" && socket.data.role !== "ADMIN")
    ) {
      return;
    }

    // Prevent duplicate start clicks from replaying the introduction.
    if (getInterviewState(roomId).state !== "WAITING") {
      return;
    }

    invalidatePendingQuestion(roomId);
    try {
      void persistInterviewStatus(roomId, "LIVE");

      // WAITING -> INTRODUCTION
      let state = transitionInterview(roomId, "START_INTERVIEW");

      io.to(roomId).emit("interview:state", state);

      // INTRODUCTION -> AI_TURN
      state = transitionInterview(roomId, "AI_START");

      io.to(roomId).emit("interview:state", state);

      // Reset conversation for this interview
      interviewConversations.set(roomId, []);
      followUpQuestionTexts.delete(roomId);

      // Start with a fixed introduction question.
      // Do not let the AI jump directly into projects or technical questions.
      const openingQuestion =
        "Hello, welcome to your interview. To begin, could you briefly introduce yourself and walk me through your background?";

      interviewConversations.set(roomId, []);

      await persistQuestion(roomId, openingQuestion, "INTRODUCTION");
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
        | "RESET_QUESTION"
        | "END_INTERVIEW";
    }) => {
      const { roomId, action } = data;

      if (!roomId || !action) {
        return;
      }

      console.log(`AI control: ${action} | room: ${roomId}`);

      if (
        !socket.rooms.has(roomId) ||
        (socket.data.role !== "INTERVIEWER" && socket.data.role !== "ADMIN")
      ) {
        return;
      }

      // Reset clears the active question, but retains historical transcript
      // and database records.
      if (action === "RESET_QUESTION") {
        invalidatePendingQuestion(roomId);
        io.to(roomId).emit("ai:stop", { roomId });
        const activeQuestion = getInterviewState(roomId).currentQuestion;
        const conversation = getConversation(roomId);

        // Remove the active AI question and any short-term answer segments
        // attached to it. Database history is retained for audit/reporting.
        // This prevents the next generated question from treating a reset
        // question as completed or repeatedly circling back to it.
        if (activeQuestion) {
          let questionIndex = -1;
          for (let index = conversation.length - 1; index >= 0; index -= 1) {
            const message = conversation[index];
            if (message.speaker === "AI" && message.text === activeQuestion) {
              questionIndex = index;
              break;
            }
          }
          if (questionIndex >= 0) {
            conversation.splice(questionIndex);
          }
        }

        const resetState = transitionInterview(roomId, "RESET_QUESTION");
        io.to(roomId).emit("interview:state", resetState);
        io.to(roomId).emit("question:reset", { roomId });
        return;
      }

      // ---------------------------------------------------
      // NEXT QUESTION
      // ---------------------------------------------------

      if (action === "NEXT_QUESTION") {
        try {
          invalidatePendingQuestion(roomId);
          const state = transitionInterview(roomId, "NEXT_QUESTION");
          if (state.state !== "AI_TURN") return;

          io.to(roomId).emit("ai:stop", { roomId });
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

      if (action === "HUMAN_TAKEOVER" || action === "PAUSE" || action === "END_INTERVIEW") {
        invalidatePendingQuestion(roomId);
        io.to(roomId).emit("ai:stop", { roomId });
      }

      const event = eventMap[action];
      const previousState = getInterviewState(roomId);
      const state = transitionInterview(roomId, event);

      if (action === "END_INTERVIEW") {
        // Persist status/report before notifying the UI that the interview ended,
        // so the human-evaluation form is ready immediately.
        await persistInterviewStatus(roomId, "COMPLETED");
        await persistFinalInterviewReport(roomId);
      }

      io.to(roomId).emit("interview:state", state);

      // Returning control to the AI should continue the interview rather than
      // leave it silently waiting. Generate only after a valid human turn.
      if (
        action === "HUMAN_FINISHED" &&
        previousState.aiPausedByHuman &&
        state.state === "AI_LISTENING" &&
        !state.aiPausedByHuman
      ) {
        invalidatePendingQuestion(roomId);
        const nextState = transitionInterview(roomId, "NEXT_QUESTION");
        io.to(roomId).emit("interview:state", nextState);
        await generateAndSendAIQuestion(roomId);
      }
    },
  );

// =======================================================
// LIVE SPEAKER-LABELLED TRANSCRIPTION
// =======================================================

socket.on(
  "transcript:interim",
  (data: { roomId: string; text: string }) => {
    if (!data?.roomId || typeof data.text !== "string" || !socket.rooms.has(data.roomId)) {
      return;
    }

    const role = socket.data.role;
    const speaker =
      role === "CANDIDATE" ? "CANDIDATE" :
      role === "INTERVIEWER" || role === "ADMIN" ? "HUMAN" : null;

    if (!speaker) return;

    // Interim speech is broadcast but not persisted or added to AI memory.
    // This keeps the transcript live without writing every partial word to DB.
    io.to(data.roomId).emit("transcript:interim", {
      speaker,
      text: data.text.slice(0, 500),
    });
  }
);

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

    // Store the speech in AI memory and the database.
    addConversationMessage(roomId, {
      speaker,
      text,
    });
    void persistTranscriptSegment(roomId, speaker, text);

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
        // Only accept answers from the candidate while an AI question is active.
        if (!socket.rooms.has(roomId) || socket.data.role !== "CANDIDATE") {
          return;
        }

        const currentState = getInterviewState(roomId);
        if (
          currentState.state === "WAITING" ||
          currentState.state === "COMPLETED" ||
          currentState.state === "AI_ANALYZING" ||
          currentState.state === "HUMAN_TURN" ||
          currentState.state === "PAUSED_BY_HUMAN" ||
          currentState.aiPausedByHuman ||
          !currentState.currentQuestion
        ) {
          io.to(socket.id).emit("ai:error", {
            message: "There is no active AI question to answer. Wait for the AI or return control to it.",
          });
          return;
        }

        const answeredQuestion = currentState.currentQuestion;
        let state = transitionInterview(roomId, "CANDIDATE_ANSWER");
        if (state.state !== "AI_ANALYZING") return;

        const answerPersistence = persistCandidateAnswer(roomId, answer, answeredQuestion);
        const answerId = await answerPersistence;

        // Reset, takeover, or end may happen while the answer is being saved.
        // Do not launch an unnecessary model request for a stale answer.
        const stateAfterAnswerSave = getInterviewState(roomId);
        if (
          stateAfterAnswerSave.currentQuestion !== answeredQuestion ||
          stateAfterAnswerSave.state === "COMPLETED" ||
          stateAfterAnswerSave.state === "HUMAN_TURN" ||
          stateAfterAnswerSave.state === "PAUSED_BY_HUMAN" ||
          stateAfterAnswerSave.aiPausedByHuman
        ) {
          return;
        }

        // Speech recognition already sent candidate transcript segments.
        // Avoid duplicating those segments when the answer is submitted.
        const answerAlreadyTranscribed =
          hasCandidateTranscriptSinceLastAI(roomId);

        if (!answerAlreadyTranscribed) {
          addConversationMessage(roomId, {
            speaker: "CANDIDATE",
            text: answer,
          });

          io.to(roomId).emit("transcript:update", {
            speaker: "CANDIDATE",
            text: answer,
            timestamp: new Date().toISOString(),
          });
        }

        // The introduction is an opening warm-up, not an HR interview loop.
        // Save it, then move directly to the first technical question.
        if (
          answeredQuestion.startsWith("Hello, welcome to your interview.") ||
          currentState.questionNumber === 1
        ) {
          state = transitionInterview(roomId, "AI_ANALYSIS_COMPLETE");
          io.to(roomId).emit("interview:state", state);
          state = transitionInterview(roomId, "NEXT_QUESTION");
          io.to(roomId).emit("interview:state", state);
          await generateAndSendAIQuestion(roomId);
          return;
        }

        // Show THINKING state
        io.to(roomId).emit("interview:state", state);

        console.log(`AI analyzing answer with Ollama | room: ${roomId}`);

        // Build context BEFORE analysis
        const context = buildAIContext(roomId);

        // REAL AI ANALYSIS
        const analysis = await analyzeCandidateAnswer(context, answer);

        // If the interviewer reset the question or took over while the model
        // was evaluating, discard this stale result instead of changing turns.
        const latestStateAfterAnalysis = getInterviewState(roomId);
        if (
          latestStateAfterAnalysis.state !== "AI_ANALYZING" ||
          latestStateAfterAnalysis.state === "COMPLETED" ||
          latestStateAfterAnalysis.state === "HUMAN_TURN" ||
          latestStateAfterAnalysis.state === "PAUSED_BY_HUMAN" ||
          latestStateAfterAnalysis.aiPausedByHuman ||
          latestStateAfterAnalysis.currentQuestion !== answeredQuestion
        ) {
          return;
        }

        console.log(`AI score: ${analysis.score}/10`);

        console.log(`AI feedback: ${analysis.feedback}`);

        await persistAIEvaluation(roomId, answerId, analysis);

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

        if (
          analysis.shouldFollowUp &&
          analysis.followUpQuestion &&
          answeredQuestion &&
          !hasAskedFollowUp(roomId, answeredQuestion)
        ) {
          const followUp = analysis.followUpQuestion.trim();
          markFollowUp(roomId, followUp);

          state = transitionInterview(roomId, "AI_FOLLOW_UP");

          state = setCurrentQuestion(roomId, followUp);

          await persistQuestion(roomId, followUp, "FOLLOW_UP");

          // A reset/takeover may occur while the database write is pending.
          const latestAfterFollowUpSave = getInterviewState(roomId);
          if (
            latestAfterFollowUpSave.currentQuestion !== followUp ||
            latestAfterFollowUpSave.state === "COMPLETED" ||
            latestAfterFollowUpSave.state === "HUMAN_TURN" ||
            latestAfterFollowUpSave.state === "PAUSED_BY_HUMAN" ||
            latestAfterFollowUpSave.aiPausedByHuman
          ) {
            return;
          }

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

          // Move back to AI_TURN and increment the question number before
          // generating the next independent question.
          state = transitionInterview(roomId, "NEXT_QUESTION");
          io.to(roomId).emit("interview:state", state);

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
      if (
        !data?.roomId ||
        !data.question ||
        !data.question.trim() ||
        !socket.rooms.has(data.roomId) ||
        (socket.data.role !== "INTERVIEWER" && socket.data.role !== "ADMIN")
      ) {
        return;
      }

      const question = data.question.trim();

      const state = setCurrentQuestion(data.roomId, question);

      void persistQuestion(data.roomId, question, "TECHNICAL");

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

      const target = targetSocketId ? io.sockets.sockets.get(targetSocketId) : undefined;
      const sharesInterviewRoom = Boolean(
        target && [...socket.rooms].some((roomId) => roomId !== socket.id && target.rooms.has(roomId)),
      );
      if (!targetSocketId || !offer || !sharesInterviewRoom) return;

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

      const target = targetSocketId ? io.sockets.sockets.get(targetSocketId) : undefined;
      const sharesInterviewRoom = Boolean(
        target && [...socket.rooms].some((roomId) => roomId !== socket.id && target.rooms.has(roomId)),
      );
      if (!targetSocketId || !answer || !sharesInterviewRoom) return;

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

      const target = targetSocketId ? io.sockets.sockets.get(targetSocketId) : undefined;
      const sharesInterviewRoom = Boolean(
        target && [...socket.rooms].some((roomId) => roomId !== socket.id && target.rooms.has(roomId)),
      );
      if (!targetSocketId || !candidate || !sharesInterviewRoom) return;

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
      if (
        !data?.roomId ||
        !data.message ||
        !data.message.trim() ||
        !socket.rooms.has(data.roomId)
      ) {
        return;
      }

      io.to(data.roomId).emit("chat-message", {
        senderSocketId: socket.id,

        senderName: socket.data.name ?? "Participant",

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
