import "server-only";
/**
 * Server-side confirmation for a route whose action became tier C, or whose
 * own-PIN check used to run only through the verify-only endpoint before the
 * action ("simpler confirmations", 2026-11-14).
 *
 * The request body carries `security: { pin }` (or `{ password }` while the
 * person has no PIN). It is verified here, in the same request as the action,
 * with verifySensitiveAction against the actual signed-in person: refused
 * while testing as someone else, counted toward the lockout, and audited
 * (SENSITIVE_ACTION_CONFIRMED, naming the credential used).
 *
 * Status codes match the other sensitive routes: 423 for a refused credential
 * (wrong, missing, locked, no PIN and no password), 403 for testing as someone
 * else or a missing grant, 401 when signed out.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { SensitiveVerificationError, isSensitiveRefusal, verifySensitiveAction } from "./admin-verification";
import { SENSITIVE_VERIFICATION_TEXT } from "./pin-rules";
import type { SensitiveAction } from "./sensitive-actions";

export const routeSecuritySchema = z
  .object({ pin: z.string().max(200).optional(), password: z.string().max(500).optional(), newPin: z.string().max(32).optional() })
  .optional();

export type RouteSecurity = z.infer<typeof routeSecuritySchema>;

/** The `security` object of a parsed request body, or undefined. */
export function securityFromBody(body: unknown): RouteSecurity {
  if (!body || typeof body !== "object") return undefined;
  const parsed = routeSecuritySchema.safeParse((body as { security?: unknown }).security);
  return parsed.success ? parsed.data : undefined;
}

type RouteSession = { user: { id: string }; impersonation?: unknown };

/** The response a refused confirmation answers with. */
export function sensitiveRefusalResponse(error: unknown): NextResponse {
  const code = error instanceof SensitiveVerificationError ? error.code : undefined;
  const message = error instanceof Error && error.message ? error.message : "INVALID_SECURITY_VERIFICATION";
  let status = 400;
  if (code === "ACTUAL_ACTOR_REQUIRED" || message === "FORBIDDEN") status = 403;
  else if (message === "UNAUTHORIZED") status = 401;
  else if (isSensitiveRefusal(error)) status = 423;
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

/**
 * Null when the person's own credential confirms the action; otherwise the
 * response to return before anything changes.
 */
export async function routeSecurityRefusal(
  session: RouteSession,
  security: RouteSecurity | null,
  action?: SensitiveAction,
): Promise<NextResponse | null> {
  if (session.impersonation) {
    return NextResponse.json(
      { error: SENSITIVE_VERIFICATION_TEXT.ACTUAL_ACTOR_REQUIRED, code: "ACTUAL_ACTOR_REQUIRED" },
      { status: 403 },
    );
  }
  try {
    if (action) await verifySensitiveAction(session.user.id, security ?? null, action);
    else await verifySensitiveAction(session.user.id, security ?? null);
    return null;
  } catch (error) {
    return sensitiveRefusalResponse(error);
  }
}
