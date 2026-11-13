import "server-only";
import { NextResponse } from "next/server";
import { isSensitiveRefusal, SensitiveVerificationError } from "@/lib/security/admin-verification";
import { AgentDecisionError } from "./action-execute";

export const AGENT_REQUEST_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Maps a refusal to its status and the server's own sentence; unknown errors never leak details. */
export function agentRequestFailure(error: unknown, fallback: string) {
  if (error instanceof AgentDecisionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: AGENT_REQUEST_HEADERS });
  if (isSensitiveRefusal(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Confirm with your PIN.", code: error instanceof SensitiveVerificationError ? error.code : undefined }, { status: 423, headers: AGENT_REQUEST_HEADERS });
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: AGENT_REQUEST_HEADERS });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to agent requests." }, { status: 403, headers: AGENT_REQUEST_HEADERS });
  return NextResponse.json({ error: fallback }, { status: 500, headers: AGENT_REQUEST_HEADERS });
}
