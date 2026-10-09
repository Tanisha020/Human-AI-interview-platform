import {
  AIAnswerAnalysis,
  AIProvider,
  AIQuestion,
  InterviewContext,
} from "./ai-provider";

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || "qwen2.5:3b";

type OllamaResponse = {
  message?: {
    content?: string;
  };
  response?: string;
};

async function callOllama(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      stream: false,
      format: "json",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Ollama request failed: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as OllamaResponse;

  const content =
    data.message?.content ?? data.response ?? "";

  if (!content.trim()) {
    throw new Error("Ollama returned an empty response.");
  }

  return content;
}

function parseJSON<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(
        text.slice(start, end + 1)
      ) as T;
    }

    throw new Error(
      `Could not parse Ollama JSON response: ${text}`
    );
  }
}

function buildConversation(
  conversation: InterviewContext["conversation"]
): string {
  if (!conversation.length) {
    return "No previous conversation.";
  }

  return conversation
    .slice(-10)
    .map(
      (item) =>
        `${item.speaker}: ${item.text}`
    )
    .join("\n");
}

export class OllamaProvider implements AIProvider {
  async generateQuestion(
    context: InterviewContext
  ): Promise<AIQuestion> {
    const conversation =
      buildConversation(context.conversation);

    const prompt = `
You are an experienced software engineering interviewer conducting a realistic technical interview.

INTERVIEW DETAILS

Job title:
${context.jobTitle || "Software Engineer"}

Job description:
${context.jobDescription || "General software engineering role"}

Difficulty:
${context.difficulty || "MEDIUM"}

Question number:
${context.questionNumber}

Previous question:
${context.currentQuestion || "None"}

Recent conversation:
${conversation}

INTERVIEW FLOW

The first question must be an introduction question. This is already handled separately by the application.

After the introduction, follow a natural technical interview progression:

1. Start with programming fundamentals, language concepts, object-oriented programming, and basic computer science.
2. Move to data structures, algorithms, time complexity, space complexity, and problem-solving.
3. Cover DBMS, operating systems, computer networks, and software engineering fundamentals.
4. Discuss projects, implementation choices, debugging, design decisions, and real-world scenarios later.
5. Include occasional behavioral questions, but do not make the interview HR-only.

ADAPTIVE QUESTIONING

Ask relevant follow-up questions when answers are incomplete or interesting.
Adjust difficulty according to the candidate's answers.
Consider the full conversation and questions already asked.
Avoid repeating questions.
Do not jump into project-specific questions too early.
Consider relevant statements made by the human interviewer.
Ask exactly one question at a time.

RULES

- Sound like a real interviewer.
- Do not give the answer.
- Do not add unnecessary explanations.
- Keep questions relevant to the job and difficulty.
- Return only valid JSON.

Return this JSON structure:
{
  "question": "Your next interview question",
  "type": "INTRODUCTION | TECHNICAL | BEHAVIORAL | FOLLOW_UP",
  "reason": "Short explanation"
}
`;

    const result = await callOllama(prompt);

    const question = parseJSON<AIQuestion>(result);

    return {
      question: question.question,
      type: question.type,
      reason: question.reason,
    };
  }

  async analyzeAnswer(
    context: InterviewContext,
    answer: string
  ): Promise<AIAnswerAnalysis> {
    const conversation =
      buildConversation(context.conversation);

    const prompt = `
You are evaluating a candidate in a software engineering interview.

Interview details:

Job title:
${context.jobTitle || "Software Engineer"}

Difficulty:
${context.difficulty || "MEDIUM"}

Current question:
${context.currentQuestion || "Unknown"}

Candidate answer:
${answer}

Recent conversation:
${conversation}

Evaluate the candidate answer.

Evaluate:

- technical correctness
- relevance
- clarity
- depth
- problem solving

Give a score from 0 to 10.

Decide whether a follow-up question would be useful.

If a follow-up is useful, create exactly ONE follow-up question.

Return ONLY valid JSON:

{
  "score": 0,
  "strengths": [],
  "weaknesses": [],
  "feedback": "string",
  "shouldFollowUp": true,
  "followUpQuestion": "string"
}

Rules:

1. score must be between 0 and 10.
2. Do not judge appearance or facial expressions.
3. Do not make assumptions about personality.
4. Evaluate only the answer.
5. If the answer is strong and complete,
   shouldFollowUp can be false.
`;

    const result = await callOllama(prompt);

    const analysis =
      parseJSON<AIAnswerAnalysis>(result);

    return {
      score: Math.max(
        0,
        Math.min(10, Number(analysis.score) || 0)
      ),
      strengths: Array.isArray(analysis.strengths)
        ? analysis.strengths
        : [],
      weaknesses: Array.isArray(analysis.weaknesses)
        ? analysis.weaknesses
        : [],
      feedback: analysis.feedback || "",
      shouldFollowUp:
        Boolean(analysis.shouldFollowUp) &&
        Boolean(analysis.followUpQuestion),
      followUpQuestion:
        analysis.followUpQuestion || undefined,
    };
  }
}