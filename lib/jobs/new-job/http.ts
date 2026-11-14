import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Shared answers for the New job page's read-only preview routes: the live
 * session/role guard's refusals (401/403), a refused query (400) and anything
 * else as a plain failure. Never caches.
 */
export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function previewJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function previewError(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return previewJson({ error: "Sign in again to continue." }, 401);
  if (message === "FORBIDDEN") return previewJson({ error: "You do not have access to create jobs." }, 403);
  if (err instanceof ZodError) return previewJson({ error: err.issues[0]?.message ?? "The request is not valid." }, 400);
  return previewJson({ error: fallback }, 500);
}
