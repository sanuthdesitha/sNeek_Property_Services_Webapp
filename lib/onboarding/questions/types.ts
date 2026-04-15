export type QuestionFieldType = "boolean" | "text" | "number" | "select" | "multiselect" | "photo" | "textarea";

export interface QuestionOption {
  value: string;
  label: string;
}

export interface QuestionCondition {
  field: string;
  operator: "eq" | "neq" | "gt" | "lt" | "includes" | "exists";
  value: unknown;
}

export interface OnboardingQuestion {
  id: string;
  category: string;
  label: string;
  type: QuestionFieldType;
  options?: QuestionOption[];
  required: boolean;
  showIf: QuestionCondition[];
  affects: string[];
}
