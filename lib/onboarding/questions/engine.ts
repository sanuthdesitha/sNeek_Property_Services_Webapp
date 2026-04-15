import { ALL_QUESTIONS } from "./registry";
import { evaluateConditions } from "./conditions";
import type { OnboardingQuestion } from "./types";

export function getRelevantQuestions(
  currentAnswers: Record<string, unknown>,
  completedQuestionIds: string[]
): OnboardingQuestion[] {
  return ALL_QUESTIONS.filter((q) => {
    if (completedQuestionIds.includes(q.id)) return false;
    return evaluateConditions(q.showIf, currentAnswers);
  });
}
