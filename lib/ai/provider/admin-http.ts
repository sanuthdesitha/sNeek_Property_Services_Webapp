import "server-only";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";

export const AI_ADMIN_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export class AiAdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Settings, AI is administrator-only, and changes are made by the signed-in
 * administrator as themselves (never while testing as someone).
 */
export async function requireAiAdmin(options: { write: boolean }) {
  const session = await requireRole([Role.ADMIN]);
  if (options.write && session.impersonation) throw new AiAdminError(403, "AI settings cannot be changed while testing as someone.");
  return session;
}

export function aiAdminFailure(error: unknown, fallback: string) {
  if (error instanceof AiAdminError) return NextResponse.json({ error: error.message }, { status: error.status, headers: AI_ADMIN_HEADERS });
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: AI_ADMIN_HEADERS });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Only administrators can open AI settings." }, { status: 403, headers: AI_ADMIN_HEADERS });
  return NextResponse.json({ error: fallback }, { status: 500, headers: AI_ADMIN_HEADERS });
}
