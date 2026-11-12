import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SensitiveVerificationError } from "@/lib/security/admin-verification";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";
import { RulesEditError } from "./service";
import { SchedulingRulesUnavailableError } from "./store";

/** One error mapping for every scheduling-rules route; never a success-shaped body. */
export function rulesErrorResponse(error: unknown): NextResponse {
  if (error instanceof RulesEditError) {
    return NextResponse.json({ error: error.message, code: error.code, ...(error.detail ?? {}) }, { status: error.status });
  }
  if (error instanceof SchedulingRulesUnavailableError) {
    return NextResponse.json({ error: error.message, code: error.code, reason: error.reason }, { status: 503 });
  }
  if (error instanceof SensitiveVerificationError) {
    const status = error.code === "UNAUTHORIZED" ? 401 : error.code === "FORBIDDEN" || error.code === "ACTUAL_ACTOR_REQUIRED" ? 403 : 423;
    return NextResponse.json({ error: sensitiveVerificationText(error.message), code: error.code }, { status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Review the request fields.", code: "INVALID_REQUEST" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Your access does not include the scheduling rules." }, { status: 403 });
  return NextResponse.json({ error: "The scheduling rules could not be processed. Nothing was changed." }, { status: 500 });
}

export function noStore(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
