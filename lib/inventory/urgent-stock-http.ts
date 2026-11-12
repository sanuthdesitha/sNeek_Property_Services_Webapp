/**
 * Shared response helpers for the urgent stock routes: no-store JSON, the
 * same-origin check on writes, and one mapping from service errors to status
 * codes (UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT… 409,
 * validation 400). Messages are the service's own reasons.
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

export const urgentJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "");
  return ["http", "https"].includes(protocol) && req.headers.get("origin") === `${protocol}://${host}`;
}

export function urgentFailure(error: unknown, fallback = "Could not save.") {
  if (error instanceof ZodError) return urgentJson({ error: error.issues[0]?.message ?? "Invalid request." }, 400);
  const message = error instanceof Error && error.message ? error.message : fallback;
  if (message === "UNAUTHORIZED") return urgentJson({ error: "Sign in again." }, 401);
  if (message === "FORBIDDEN") return urgentJson({ error: "You do not have access to this." }, 403);
  if (message === "NOT_FOUND") return urgentJson({ error: "Not found." }, 404);
  if (message.startsWith("CONFLICT")) return urgentJson({ error: message.replace(/^CONFLICT: /, "") }, 409);
  return urgentJson({ error: message }, 400);
}
