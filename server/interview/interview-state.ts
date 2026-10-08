export type InterviewState =
  | "WAITING"
  | "INTRODUCTION"
  | "AI_TURN"
  | "AI_LISTENING"
  | "AI_ANALYZING"
  | "AI_FOLLOW_UP"
  | "HUMAN_TURN"
  | "PAUSED_BY_HUMAN"
  | "COMPLETED";

export type InterviewActor =
  | "SYSTEM"
  | "AI"
  | "CANDIDATE"
  | "HUMAN";

export type AIStatus =
  | "IDLE"
  | "SPEAKING"
  | "LISTENING"
  | "THINKING"
  | "PAUSED";

export type InterviewEvent =
  | "START_INTERVIEW"
  | "AI_START"
  | "AI_FINISHED_SPEAKING"
  | "CANDIDATE_STARTED_SPEAKING"
  | "CANDIDATE_FINISHED_SPEAKING"
  | "CANDIDATE_ANSWER"
  | "AI_ANALYSIS_COMPLETE"
  | "AI_FOLLOW_UP"
  | "HUMAN_TAKEOVER"
  | "HUMAN_FINISHED"
  | "PAUSE_AI"
  | "RESUME_AI"
  | "NEXT_QUESTION"
  | "END_INTERVIEW";

export type InterviewStateData = {
  roomId: string;
  state: InterviewState;
  aiStatus: AIStatus;
  currentQuestion: string | null;
  currentSpeaker: InterviewActor;
  questionNumber: number;
  startedAt: string | null;
  updatedAt: string;
  aiPausedByHuman: boolean;
};

export const INITIAL_INTERVIEW_STATE: Omit<
  InterviewStateData,
  "roomId"
> = {
  state: "WAITING",
  aiStatus: "IDLE",
  currentQuestion: null,
  currentSpeaker: "SYSTEM",
  questionNumber: 0,
  startedAt: null,
  updatedAt: new Date().toISOString(),
  aiPausedByHuman: false,
};