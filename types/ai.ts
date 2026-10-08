export interface InterviewContext {
  jobTitle: string;
  jobDescription: string;
  requiredSkills: string[];
  difficulty: "EASY" | "MEDIUM" | "HARD";

  previousQuestions: string[];

  currentQuestion?: string;

  candidateAnswer?: string;
}

export interface AIQuestion {
  question: string;

  category:
    | "TECHNICAL"
    | "BEHAVIORAL"
    | "PROBLEM_SOLVING"
    | "GENERAL";

  difficulty:
    | "EASY"
    | "MEDIUM"
    | "HARD";

  expectedTopics: string[];
}

export interface AnswerEvaluation {
  technicalKnowledge: number;
  problemSolving: number;
  communication: number;
  relevance: number;
  confidence: number;

  strengths: string[];
  weaknesses: string[];

  feedback: string;
}

export interface AIProvider {
  generateQuestion(
    context: InterviewContext
  ): Promise<AIQuestion>;

  analyzeAnswer(
    context: InterviewContext
  ): Promise<AnswerEvaluation>;

  generateFollowUp(
    context: InterviewContext
  ): Promise<AIQuestion>;

  generateFinalReport(
    context: InterviewContext
  ): Promise<string>;
}