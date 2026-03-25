import { z } from "zod";

export function getValidationErrorMessage(error: unknown, fallback = "Invalid input.") {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? fallback;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
