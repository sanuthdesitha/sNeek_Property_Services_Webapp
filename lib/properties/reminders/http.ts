import "server-only";
/** Shared responses for the property reminder routes. */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ReminderServiceError } from "./service";

export const privateHeaders = { "Cache-Control": "private, no-store" };

export function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

export function reminderErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof ReminderServiceError) return refuse(error.status, error.message, error.code);
  if (error instanceof ZodError || error instanceof SyntaxError) {
    const first = error instanceof ZodError ? error.issues.find((issue) => issue.code === "custom")?.message : null;
    return refuse(400, first ?? "Check the reminder text (up to 280 characters), when it shows and how long it lasts.", "INVALID_INPUT");
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
  if (message === "FORBIDDEN") return refuse(403, "You cannot do this.", "FORBIDDEN");
  console.error("[property-reminders]", error);
  return refuse(500, fallback, "FAILED");
}
