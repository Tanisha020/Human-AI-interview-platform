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

async function callOllama(prompt: string, maxTokens = 512): Promise<string> {
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
        // Keep evaluation output comfortably below the limit while allowing complete JSON.
        num_predict: maxTokens,
      },
    }),
    signal: AbortSignal.timeout(90000),
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
      `Ollama returned invalid or truncated JSON. Response starts with: ${text.slice(0, 240)}`
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

INTERVIEW FLOW — EASY TO MODERATE

The application already asked the introduction question. Do not ask another introduction or HR question at the start.

Start easy and increase difficulty gradually only when the candidate is doing well:
- Question 2: basic programming or OOP definition, such as encapsulation, inheritance, or stack vs queue.
- Question 3: a simple everyday example of that concept.
- Question 4: easy arrays, strings, or basic DSA.
- Question 5: a simple SQL/DBMS concept.
- Question 6: basic operating systems or networking.
- Question 7 onward: beginner-to-intermediate questions, then project questions when enough fundamentals have been covered.
Avoid tricky puzzles, advanced algorithms, multi-part questions, and obscure trivia unless the job description explicitly requires them.

At least 4 out of every 5 independent questions must be technical. Ask one clear, short question at a time. Avoid repeating topics already covered.

ADAPTIVE QUESTIONING

Ask at most ONE follow-up per main question. If evaluation finds a relevant scoring dimension below 6/10, ask a simple, specific follow-up that gives the candidate a fair opportunity to demonstrate that skill. Do not reveal the answer or ask an unrelated question. If the answer is already adequate, move on.
Use the human interviewer's transcript as context, but do not let it derail the technical interview.
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
You are a fair, supportive software engineering interviewer. Evaluate the candidate's answer generously but honestly.

Job: ${context.jobTitle || "Software Engineer"}
Difficulty: ${context.difficulty || "EASY"}
Question: ${context.currentQuestion || "Unknown"}
Candidate answer: ${answer}
Recent conversation (for context): ${conversation.slice(-900)}

SCORING POLICY
- Score every dimension on every answer using integers 0-10: technicalKnowledge, problemSolving, communication, relevance, confidence, behavioral, jobSkills.
- Be lenient for beginner-level answers. If the main idea is correct and relevant, a short answer normally deserves 6-8/10, not 1-3 just because details are missing.
- Give credit for correct examples and partial understanding. Reserve 0-3 for absent, unrelated, or substantially incorrect answers; use 4-5 for partly correct answers; 6-8 for mostly correct answers; 9-10 for excellent, well-supported answers.
- Do not require code or a real-world example unless the question asked for one.
- Do not penalize brevity, grammar, accent, or lack of verbosity when the core answer is correct.
- Score confidence only from the answer's clarity and directness; never infer it from appearance or voice.
- For a technical question, behavioral is NOT APPLICABLE: set it equal to the overall score instead of giving zero. For a behavioral question, assess the behavioral evidence.
- Assess problemSolving fairly: for a definition question, use the candidate's demonstrated reasoning and understanding rather than requiring a full solution.
- Give a specific, encouraging feedback sentence and at most one short strength and one short improvement.
- If any applicable dimension is below 6 and a simple follow-up could fairly clarify the candidate's understanding, set shouldFollowUp=true and ask ONE short, coherent question targeted at that dimension. The follow-up must stay on the same topic, must not reveal the answer, and should let the candidate demonstrate their knowledge. Do not ask a follow-up just to force a higher score.
- If no follow-up is needed, use shouldFollowUp=false and followUpQuestion="".

Return ONLY compact valid JSON with exactly these keys and short values:
{"score":6,"strengths":["one strength"],"weaknesses":["one improvement"],"feedback":"Encouraging, specific feedback.","technicalKnowledge":6,"problemSolving":6,"communication":6,"relevance":6,"confidence":6,"behavioral":6,"jobSkills":6,"shouldFollowUp":false,"followUpQuestion":""}
`;

    const result = await callOllama(prompt, 1024);

    let analysis: AIAnswerAnalysis;

    try {
      analysis = parseJSON<AIAnswerAnalysis>(result);
    } catch {
      // Retry once with an even smaller request if the local model truncates JSON.
      const compactPrompt = `Evaluate this interview answer fairly and leniently. Question: ${context.currentQuestion || "Unknown"}. Answer: ${answer.slice(0, 1200)}. Return ONLY compact valid JSON with integer scores 0-10 for all dimensions. A basically correct answer should score 6-8. For technical questions, behavioral equals the overall score. If any dimension is below 6, ask one short relevant follow-up to clarify it; do not reveal the answer. Otherwise no follow-up. Required schema: {"score":6,"strengths":["short"],"weaknesses":["short"],"feedback":"short","technicalKnowledge":6,"problemSolving":6,"communication":6,"relevance":6,"confidence":6,"behavioral":6,"jobSkills":6,"shouldFollowUp":false,"followUpQuestion":""}`;
      const retryResult = await callOllama(compactPrompt, 512);
      analysis = parseJSON<AIAnswerAnalysis>(retryResult);
    }

    if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
      throw new Error("Ollama evaluation response was not a JSON object.");
    }

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