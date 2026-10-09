export type InterviewContext = {
  jobTitle?: string;
  jobDescription?: string;
  difficulty?: string;
  questionNumber: number;
  currentQuestion?: string | null;
  conversation: {
    speaker: "AI" | "CANDIDATE" | "HUMAN";
    text: string;
  }[];
};

export type AIQuestion = {
  question: string;
  type: "INTRODUCTION" | "TECHNICAL" | "BEHAVIORAL" | "FOLLOW_UP";
  reason?: string;
};

export type AIAnswerAnalysis = {
  score: number;
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  // Optional per-dimension scores returned by providers that support them.
  // The server falls back to the overall score when a dimension is omitted.
  technicalKnowledge?: number;
  problemSolving?: number;
  communication?: number;
  relevance?: number;
  confidence?: number;
  behavioral?: number;
  jobSkills?: number;
  shouldFollowUp: boolean;
  followUpQuestion?: string;
};

export interface AIProvider {
  generateQuestion(
    context: InterviewContext
  ): Promise<AIQuestion>;

  analyzeAnswer(
    context: InterviewContext,
    answer: string
  ): Promise<AIAnswerAnalysis>;
}