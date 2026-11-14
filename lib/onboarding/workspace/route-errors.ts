import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";
import { OnboardingWorkspaceError } from "./service";

/** One mapping from thrown errors to answers for every onboarding route. Raw internals never reach the browser. */
export function onboardingRouteError(error: unknown, context: string): NextResponse {
  if (error instanceof OnboardingWorkspaceError) return NextResponse.json({ error: error.message, ...(error.detail ?? {}) }, { status: error.status });
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return NextResponse.json({ error: `Check ${issue.path.join(".") || "the request"}: ${issue.message}` }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to property onboarding." }, { status: 403 });
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
  if (status >= 400 && status < 500 && message) return NextResponse.json({ error: message }, { status });
  logger.error({ err: error }, `Onboarding route failed: ${context}`);
  return NextResponse.json({ error: "Something went wrong on the server. Nothing was changed by this request; try again." }, { status: 500 });
}
