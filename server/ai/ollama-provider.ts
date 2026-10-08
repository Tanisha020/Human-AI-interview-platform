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
You are an experienced software engineering interviewer.

Your job is to conduct a realistic technical interview.

Interview details:

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

Generate the next interview question.

Rules:

1. Ask exactly ONE question.
2. Do not repeat a previous question.
3. Keep the question relevant to the role.
4. Adjust difficulty according to the interview difficulty.
5. If the candidate mentioned a project or technology,
   you may ask a deeper question about it.
6. Sound like a real interviewer.
7. Do not give the answer.
8. Do not add unnecessary explanation.

Return ONLY valid JSON:

{
  "question": "string",
  "type": "INTRODUCTION | TECHNICAL | BEHAVIORAL | FOLLOW_UP",
  "reason": "short explanation"
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