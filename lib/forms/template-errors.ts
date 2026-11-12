/**
 * Typed failures for the form-template draft, publish and bulk services, and
 * the one mapping from a thrown error to an HTTP status used by their routes.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type TemplateErrorCode =
  | "NOT_FOUND"
  | "STALE_TEMPLATE"
  | "DRAFT_EXISTS"
  | "INVALID_SCHEMA"
  | "CHECKS_FAILED"
  | "INVALID_INPUT";

const STATUS: Record<TemplateErrorCode, number> = {
  NOT_FOUND: 404,
  STALE_TEMPLATE: 409,
  DRAFT_EXISTS: 409,
  INVALID_SCHEMA: 422,
  CHECKS_FAILED: 422,
  INVALID_INPUT: 400,
};

export class TemplateServiceError extends Error {
  constructor(
    readonly code: TemplateErrorCode,
    message: string,
    /** For STALE_TEMPLATE: the edit token that is current now. */
    readonly currentToken?: string,
    /** For INVALID_SCHEMA / CHECKS_FAILED: every problem found, for the builder to list. */
    readonly issues?: ReadonlyArray<{ path?: string; message: string; fieldId?: string; sectionId?: string }>,
  ) {
    super(message);
    this.name = "TemplateServiceError";
  }
}

export function staleTemplateError(currentToken: string): TemplateServiceError {
  return new TemplateServiceError(
    "STALE_TEMPLATE",
    "This template changed since you opened it. Reload to see the current version — saving now would overwrite that change.",
    currentToken,
  );
}

export function templateErrorStatus(error: unknown): number {
  if (error instanceof TemplateServiceError) return STATUS[error.code];
  if (error instanceof ZodError) return 400;
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}

export function templateErrorResponse(error: unknown, fallback = "The request could not be completed."): NextResponse {
  const status = templateErrorStatus(error);
  const message =
    error instanceof ZodError
      ? error.issues[0]?.message ?? "Invalid input"
      : error instanceof Error && error.message
        ? error.message
        : fallback;
  const body: Record<string, unknown> = { error: message };
  if (error instanceof TemplateServiceError) {
    body.code = error.code;
    if (error.currentToken) body.currentUpdatedAt = error.currentToken;
    if (error.issues?.length) body.issues = error.issues;
  }
  return NextResponse.json(body, { status });
}
