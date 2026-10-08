export type MockQuestion = {
  question: string;
  type:
    | "INTRODUCTION"
    | "TECHNICAL"
    | "FOLLOW_UP";
};

const questions: MockQuestion[] = [
  {
    question:
      "Tell me about yourself and your recent technical projects.",
    type: "INTRODUCTION",
  },
  {
    question:
      "Can you explain how a HashMap works internally in Java?",
    type: "TECHNICAL",
  },
  {
    question:
      "What is the difference between an interface and an abstract class in Java?",
    type: "TECHNICAL",
  },
  {
    question:
      "Suppose your application suddenly becomes very slow when the number of users increases. How would you debug the problem?",
    type: "TECHNICAL",
  },
];

export function getInitialQuestion(): MockQuestion {
  return questions[0];
}

export function getNextQuestion(
  questionNumber: number
): MockQuestion {
  const index = Math.min(
    questionNumber,
    questions.length - 1
  );

  return questions[index];
}

export function generateFollowUp(
  answer: string
): string {
  const cleanAnswer =
    answer.trim();

  if (!cleanAnswer) {
    return "Could you elaborate a little more on your answer?";
  }

  const lowerAnswer =
    cleanAnswer.toLowerCase();

  if (
    lowerAnswer.includes("project")
  ) {
    return "What was the most challenging technical decision you made in that project, and why?";
  }

  if (
    lowerAnswer.includes("hashmap")
  ) {
    return "What happens when two keys produce the same hash value?";
  }

  if (
    lowerAnswer.includes("interface")
  ) {
    return "Can you give me a practical example of when you would choose an interface?";
  }

  return "Can you explain your answer with a practical example?";
}