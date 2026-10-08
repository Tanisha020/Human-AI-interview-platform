import {
  AIStatus,
  INITIAL_INTERVIEW_STATE,
  InterviewActor,
  InterviewEvent,
  InterviewStateData,
} from "./interview-state";

const interviewStates = new Map<
  string,
  InterviewStateData
>();

function createInitialState(
  roomId: string
): InterviewStateData {
  return {
    roomId,
    ...INITIAL_INTERVIEW_STATE,
    updatedAt: new Date().toISOString(),
  };
}

export function getInterviewState(
  roomId: string
): InterviewStateData {
  let state = interviewStates.get(roomId);

  if (!state) {
    state = createInitialState(roomId);
    interviewStates.set(roomId, state);
  }

  return state;
}

function updateState(
  roomId: string,
  updates: Partial<InterviewStateData>
): InterviewStateData {
  const current = getInterviewState(roomId);

  const next: InterviewStateData = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  interviewStates.set(roomId, next);

  return next;
}

export function transitionInterview(
  roomId: string,
  event: InterviewEvent
): InterviewStateData {
  const current = getInterviewState(roomId);

  switch (event) {
    case "START_INTERVIEW": {
      if (current.state !== "WAITING") {
        return current;
      }

      return updateState(roomId, {
        state: "INTRODUCTION",
        currentSpeaker: "HUMAN",
        aiStatus: "IDLE",
        startedAt: new Date().toISOString(),
      });
    }

    case "AI_START": {
      if (current.state === "PAUSED_BY_HUMAN") {
        return current;
      }

      return updateState(roomId, {
        state: "AI_TURN",
        currentSpeaker: "AI",
        aiStatus: "SPEAKING",
      });
    }

    case "AI_FINISHED_SPEAKING": {
      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
      });
    }

    case "CANDIDATE_STARTED_SPEAKING": {
      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
      });
    }

    case "CANDIDATE_FINISHED_SPEAKING":
    case "CANDIDATE_ANSWER": {
      return updateState(roomId, {
        state: "AI_ANALYZING",
        currentSpeaker: "AI",
        aiStatus: "THINKING",
      });
    }

    case "AI_ANALYSIS_COMPLETE": {
      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
      });
    }

    case "AI_FOLLOW_UP": {
      return updateState(roomId, {
        state: "AI_FOLLOW_UP",
        currentSpeaker: "AI",
        aiStatus: "SPEAKING",
        questionNumber: current.questionNumber + 1,
      });
    }

    case "HUMAN_TAKEOVER": {
      return updateState(roomId, {
        state: "HUMAN_TURN",
        currentSpeaker: "HUMAN",
        aiStatus: "PAUSED",
        aiPausedByHuman: true,
      });
    }

    case "HUMAN_FINISHED": {
      if (!current.aiPausedByHuman) {
        return current;
      }

      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
        aiPausedByHuman: false,
      });
    }

    case "PAUSE_AI": {
      return updateState(roomId, {
        state: "PAUSED_BY_HUMAN",
        currentSpeaker: "HUMAN",
        aiStatus: "PAUSED",
        aiPausedByHuman: true,
      });
    }

    case "RESUME_AI": {
      return updateState(roomId, {
        state: "AI_LISTENING",
        currentSpeaker: "CANDIDATE",
        aiStatus: "LISTENING",
        aiPausedByHuman: false,
      });
    }

    case "NEXT_QUESTION": {
      return updateState(roomId, {
        state: "AI_TURN",
        currentSpeaker: "AI",
        aiStatus: "SPEAKING",
        questionNumber: current.questionNumber + 1,
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

    default: {
      return current;
    }
  }
}

export function setCurrentQuestion(
  roomId: string,
  question: string
): InterviewStateData {
  return updateState(roomId, {
    currentQuestion: question,
  });
}

export function setAIStatus(
  roomId: string,
  status: AIStatus
): InterviewStateData {
  return updateState(roomId, {
    aiStatus: status,
  });
}

export function setSpeaker(
  roomId: string,
  speaker: InterviewActor
): InterviewStateData {
  return updateState(roomId, {
    currentSpeaker: speaker,
  });
}

export function deleteInterviewState(
  roomId: string
): void {
  interviewStates.delete(roomId);
}