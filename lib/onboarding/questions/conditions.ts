import type { QuestionCondition } from "./types";

export function evaluateCondition(condition: QuestionCondition, answers: Record<string, unknown>): boolean {
  const value = answers[condition.field];
  switch (condition.operator) {
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "gt":
      return (value as number ?? 0) > (condition.value as number);
    case "lt":
      return (value as number ?? 0) < (condition.value as number);
    case "includes":
      return Array.isArray(value) && value.includes(condition.value);
    case "exists":
      return value !== undefined && value !== null;
    default:
      return false;
  }
}

export function evaluateConditions(conditions: QuestionCondition[], answers: Record<string, unknown>): boolean {
  return conditions.every((c) => evaluateCondition(c, answers));
}
