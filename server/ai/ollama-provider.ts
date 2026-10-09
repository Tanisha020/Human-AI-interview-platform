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
      keep_alive: "10m",
      options: {
        temperature: 0.2,
        num_predict: 160,
      },
    }),
    signal: AbortSignal.timeout(45000),
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

function clampScore(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(10, Math.round(numeric)));
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

INTERVIEW FLOW — FOLLOW THIS ORDER

The application has already asked the introduction question. Do not ask another "tell me about yourself", strengths/weaknesses, career goals, or HR question at the beginning.

Use Question number as the primary technical-interview sequence:
- 2: programming fundamentals / Java basics / OOP
- 3: OOP design or a practical Java concept
- 4: data structures and algorithms
- 5: DSA problem-solving or complexity analysis
- 6: DBMS / SQL / indexing / transactions
- 7: operating systems / processes / threads / synchronization
- 8: computer networks or system fundamentals
- 9: a project implementation or debugging decision
- 10: a practical engineering scenario
- 11 and later: continue rotating technical topics; ask at most one behavioral question in every six main questions.

At least 4 out of every 5 independent questions must be technical, problem-solving, CS fundamentals, or project-depth questions. Behavioral/HR questions must be occasional, never consecutive, and never used as filler. Ask one clear, answerable question, not a long multi-part prompt. Do not repeat topics already covered unless the candidate's answer requires a follow-up.

ADAPTIVE QUESTIONING

Ask at most ONE follow-up to any question. A follow-up should be short and specific, and is allowed only when the candidate's answer is incomplete, ambiguous, or contains a useful technical claim that needs clarification. Do not ask follow-ups just to prolong the interview.
Adjust difficulty based on answer quality, but keep the interview moving.
Use the human interviewer's transcript as context, not as a reason to switch into HR questions.
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

Give an overall score from 0 to 10 and separate scores from 0 to 10 for:
- technicalKnowledge
- problemSolving
- communication
- relevance
- confidence
- behavioral
- jobSkills

Score only evidence in the answer. For behavioral, use how clearly the answer demonstrates a relevant behavior; if the question is technical and behavioral evidence is not applicable, use the overall score rather than penalizing the candidate.

Decide whether a follow-up question would be useful.

If a follow-up is useful, create exactly ONE follow-up question.

Return ONLY valid JSON:

{
  "score": 0,
  "strengths": [],
  "weaknesses": [],
  "feedback": "string",
  "technicalKnowledge": 0,
  "problemSolving": 0,
  "communication": 0,
  "relevance": 0,
  "confidence": 0,
  "behavioral": 0,
  "jobSkills": 0,
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
      technicalKnowledge: clampScore(analysis.technicalKnowledge, Number(analysis.score) || 0),
      problemSolving: clampScore(analysis.problemSolving, Number(analysis.score) || 0),
      communication: clampScore(analysis.communication, Number(analysis.score) || 0),
      relevance: clampScore(analysis.relevance, Number(analysis.score) || 0),
      confidence: clampScore(analysis.confidence, Number(analysis.score) || 0),
      behavioral: clampScore(analysis.behavioral, Number(analysis.score) || 0),
      jobSkills: clampScore(analysis.jobSkills, Number(analysis.score) || 0),
      shouldFollowUp:
        Boolean(analysis.shouldFollowUp) &&
        Boolean(analysis.followUpQuestion),
      followUpQuestion:
        analysis.followUpQuestion || undefined,
    };
  }
}