export type UserRole =
  | "CANDIDATE"
  | "INTERVIEWER"
  | "ADMIN";

export type InterviewStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "LIVE"
  | "COMPLETED"
  | "CANCELLED";

export type InterviewDifficulty =
  | "EASY"
  | "MEDIUM"
  | "HARD";

export type ParticipantRole =
  | "CANDIDATE"
  | "INTERVIEWER";

export interface InterviewParticipant {
  id: string;
  userId: string;
  role: ParticipantRole;
  joinedAt?: Date;
  leftAt?: Date;
}

export interface Interview {
  id: string;
  title: string;
  jobTitle: string;
  jobDescription: string;
  difficulty: InterviewDifficulty;
  duration: number;
  scheduledAt: Date;
  status: InterviewStatus;
  participants: InterviewParticipant[];
}