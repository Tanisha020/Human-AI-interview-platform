import {
  AIAnswerAnalysis,
  AIProvider,
  AIQuestion,
  InterviewContext,
} from "./ai-provider";
import { OllamaProvider } from "./ollama-provider";

let provider: AIProvider | null = null;

function getProvider(): AIProvider {
  if (provider) {
    return provider;
  }

  const selectedProvider =
    process.env.AI_PROVIDER || "ollama";

  if (selectedProvider === "ollama") {
    provider = new OllamaProvider();
    return provider;
  }

  throw new Error(
    `Unsupported AI provider: ${selectedProvider}`
  );
}

export async function generateAIQuestion(
  context: InterviewContext
): Promise<AIQuestion> {
  return getProvider().generateQuestion(context);
}

export async function analyzeCandidateAnswer(
  context: InterviewContext,
  answer: string
): Promise<AIAnswerAnalysis> {
  return getProvider().analyzeAnswer(
    context,
    answer
  );
}