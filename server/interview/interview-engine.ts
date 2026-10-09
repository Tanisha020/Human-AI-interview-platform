import {
  AIStatus,
  INITIAL_INTERVIEW_STATE,
  InterviewActor,
  InterviewEvent,
  InterviewStateData,
} from "./interview-state";

const interviewStates = new Map<string, InterviewStateData>();

function createInitialState(roomId: string): InterviewStateData {
  return {
    ...INITIAL_INTERVIEW_STATE,
    roomId,
    updatedAt: new Date().toISOString(),
  };
}

export function getInterviewState(roomId: string): InterviewStateData {
  let state = interviewStates.get(roomId);

  if (!state) {
    state = createInitialState(roomId);
    interviewStates.set(roomId, state);
  }

  // Return a copy so callers cannot mutate the stored state directly.
  return { ...state };
}

function updateState(
  roomId: string,
  updates: Partial<InterviewStateData>,
): InterviewStateData {
  const current = getInterviewState(roomId);

  if (current.state === "COMPLETED") {
    return current;
  }

  const next: InterviewStateData = {
    ...current,
    ...updates,
    roomId,
    updatedAt: new Date().toISOString(),
  };

  interviewStates.set(roomId, next);
  return { ...next };
}

function isActive(state: InterviewStateData): boolean {
  return state.state !== "WAITING" && state.state !== "COMPLETED";
}

export function transitionInterview(
  roomId: string,
  event: InterviewEvent,
): InterviewStateData {
  const current = getInterviewState(roomId);

  // Completed interviews are terminal; repeated end events are harmless.
  if (current.state === "COMPLETED") {
    return current;
  }

  switch (event) {
    case "START_INTERVIEW": {
      if (current.state !== "WAITING") return current;

      return updateState(roomId, {
        state: "INTRODUCTION",
        currentSpeaker: "HUMAN",
        aiStatus: "IDLE",
        questionNumber: 1,
        startedAt: new Date().toISOString(),
        aiPausedByHuman: false,
      });
    }

    case "AI_START": {
      if (
        current.state !== "INTRODUCTION" &&
        current.state !== "AI_LISTENING"
      ) return current;
      if (current.aiPausedByHuman) return current;

      return updateState(roomId, {
        state: "AI_TURN",
        currentSpeaker: "AI",
        aiStatus: "SPEAKING",
      });
    }

    case "AI_FINISHED_SPEAKING": {
      if (
        current.state !== "AI_TURN" &&
        current.state !== "AI_FOLLOW_UP"
      ) return current;

      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
      });
    }

    case "CANDIDATE_STARTED_SPEAKING": {
      if (!isActive(current) || current.aiPausedByHuman || current.state === "HUMAN_TURN") {
        return current;
      }

      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
      });
    }

    case "CANDIDATE_FINISHED_SPEAKING":
    case "CANDIDATE_ANSWER": {
      if (
        !isActive(current) ||
        current.state === "PAUSED_BY_HUMAN" ||
        current.state === "HUMAN_TURN" ||
        current.aiPausedByHuman
      ) return current;

      return updateState(roomId, {
        state: "AI_ANALYZING",
        currentSpeaker: "AI",
        aiStatus: "THINKING",
      });
    }

    case "AI_ANALYSIS_COMPLETE": {
      if (current.state !== "AI_ANALYZING") return current;

      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
      });
    }

    case "AI_FOLLOW_UP": {
      if (
        current.state !== "AI_ANALYZING" &&
        current.state !== "AI_LISTENING"
      ) return current;
      if (current.aiPausedByHuman) return current;

      return updateState(roomId, {
        state: "AI_FOLLOW_UP",
        currentSpeaker: "AI",
        aiStatus: "SPEAKING",
      });
    }

    case "HUMAN_TAKEOVER": {
      if (!isActive(current) || current.state === "HUMAN_TURN") return current;

      return updateState(roomId, {
        state: "HUMAN_TURN",
        currentSpeaker: "HUMAN",
        aiStatus: "PAUSED",
        aiPausedByHuman: true,
      });
    }

    case "HUMAN_FINISHED":
    case "RESUME_AI": {
      if (
        current.state !== "HUMAN_TURN" &&
        current.state !== "PAUSED_BY_HUMAN"
      ) return current;
      if (!current.aiPausedByHuman) return current;

      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
        aiPausedByHuman: false,
      });
    }

    case "PAUSE_AI": {
      if (!isActive(current) || current.aiPausedByHuman) return current;

      return updateState(roomId, {
        state: "PAUSED_BY_HUMAN",
        currentSpeaker: "HUMAN",
        aiStatus: "PAUSED",
        aiPausedByHuman: true,
      });
    }

    case "NEXT_QUESTION": {
      if (
        current.state !== "INTRODUCTION" &&
        current.state !== "AI_TURN" &&
        current.state !== "AI_FOLLOW_UP" &&
        current.state !== "AI_LISTENING" &&
        current.state !== "AI_ANALYZING"
      ) return current;
      if (current.aiPausedByHuman) return current;

      return updateState(roomId, {
        state: "AI_TURN",
        currentSpeaker: "AI",
        aiStatus: "SPEAKING",
        // If RESET_QUESTION already cleared the active question, keep the same
        // number so Next Question replaces the cleared slot instead of skipping it.
        questionNumber: current.questionNumber + (current.currentQuestion ? 1 : 0),
      });
    }

    case "RESET_QUESTION": {
      if (current.state === "WAITING") return current;

      // Stop an active AI utterance and return to listening. If a human has
      // taken over, keep the human turn paused and active.
      // Reset is also valid while an answer is being analyzed. The socket
      // layer invalidates the pending analysis/generation before this transition.
      // Keep human takeover intact; otherwise return to a ready/listening state.
      if (
        current.state === "AI_TURN" ||
        current.state === "AI_FOLLOW_UP" ||
        current.state === "AI_ANALYZING"
      ) {
        return updateState(roomId, {
          currentQuestion: null,
          // If the opening introduction is reset, continue with the first
          // technical slot rather than prompting for an introduction again.
          questionNumber: current.questionNumber === 1 ? 2 : current.questionNumber,
          state: "AI_LISTENING",
          currentSpeaker: "CANDIDATE",
          aiStatus: "LISTENING",
        });
      }

      // Historical transcript/database records remain available for reports.
      return updateState(roomId, {
        currentQuestion: null,
      });
    }

    case "END_INTERVIEW": {
      return updateState(roomId, {
        state: "COMPLETED",
        currentSpeaker: "SYSTEM",
        aiStatus: "IDLE",
        aiPausedByHuman: false,
      });
    }

    default:
      return current;
  }
}

export function setCurrentQuestion(
  roomId: string,
  question: string,
): InterviewStateData {
  const current = getInterviewState(roomId);

  if (
    current.state === "COMPLETED" ||
    typeof question !== "string" ||
    !question.trim()
  ) return current;

  return updateState(roomId, {
    currentQuestion: question.trim(),
  });
}

export function setAIStatus(
  roomId: string,
  status: AIStatus,
): InterviewStateData {
  if (getInterviewState(roomId).state === "COMPLETED") {
    return getInterviewState(roomId);
  }

  return updateState(roomId, { aiStatus: status });
}

export function setSpeaker(
  roomId: string,
  speaker: InterviewActor,
): InterviewStateData {
  if (getInterviewState(roomId).state === "COMPLETED") {
    return getInterviewState(roomId);
  }

  return updateState(roomId, { currentSpeaker: speaker });
}

export function deleteInterviewState(roomId: string): void {
  interviewStates.delete(roomId);
}
