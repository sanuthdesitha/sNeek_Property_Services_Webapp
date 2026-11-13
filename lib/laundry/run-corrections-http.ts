import "server-only";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { ZodError } from "zod";
import { getApiErrorStatus } from "@/lib/api/http";
import { CapabilityDenied } from "@/lib/rbac/can";
import { SensitiveVerificationError, isSensitiveRefusal } from "@/lib/security/admin-verification";
import { RunCorrectionError, type CorrectionActor } from "./run-corrections";

export const RUN_CORRECTION_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** The effective identity, plus the administrator behind a "Test as" session. */
export function correctionActor(session: Session): CorrectionActor {
  const impersonation = (session as Session & { impersonation?: { actorId?: string } }).impersonation;
  return { id: session.user.id, role: String(session.user.role), actualActorId: impersonation?.actorId ?? null };
}

export function runCorrectionErrorResponse(error: unknown): NextResponse {
  if (error instanceof RunCorrectionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: RUN_CORRECTION_HEADERS });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Check the fields and try again.", code: "INVALID", issues: error.issues }, { status: 400, headers: RUN_CORRECTION_HEADERS });
  }
  if (error instanceof CapabilityDenied) {
    return NextResponse.json({ error: error.message, code: "CAPABILITY_REQUIRED" }, { status: 403, headers: RUN_CORRECTION_HEADERS });
  }
  if (error instanceof SensitiveVerificationError) {
    const status = isSensitiveRefusal(error) ? 423 : error.code === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: error.message, code: error.code }, { status, headers: RUN_CORRECTION_HEADERS });
  }
  const message = error instanceof Error ? error.message : "Not saved.";
  return NextResponse.json({ error: message }, { status: getApiErrorStatus(error), headers: RUN_CORRECTION_HEADERS });
}
