import "server-only";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { isSensitiveRefusal, SensitiveVerificationError, verifySensitiveAction } from "@/lib/security/admin-verification";
import { AgentAdminError } from "./admin";

export const AGENT_ADMIN_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export const credentialsSchema = z.object({ pin: z.string().max(20).optional(), password: z.string().max(500).optional(), newPin: z.string().max(20).optional() }).strict();

/**
 * Only an administrator, acting as themselves (never while testing as someone),
 * manages agents; every change also needs that administrator's own PIN.
 */
export async function requireAgentAdmin(options: { credentials?: unknown } = {}) {
  const session = await requireRole([Role.ADMIN]);
  if (session.impersonation) throw new AgentAdminError(403, "Agents cannot be managed while testing as someone.");
  if (options.credentials !== undefined) {
    const credentials = credentialsSchema.safeParse(options.credentials ?? {});
    await verifySensitiveAction(session.user.id, credentials.success ? credentials.data : {});
  }
  return session;
}

export function agentAdminFailure(error: unknown) {
  if (error instanceof AgentAdminError) return NextResponse.json({ error: error.message }, { status: error.status, headers: AGENT_ADMIN_HEADERS });
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Check the name (up to 60 characters), choose at least one area, and an expiry of 1 to 365 days." }, { status: 400, headers: AGENT_ADMIN_HEADERS });
  if (isSensitiveRefusal(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Confirm with your PIN.", code: error instanceof SensitiveVerificationError ? error.code : undefined }, { status: 423, headers: AGENT_ADMIN_HEADERS });
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: AGENT_ADMIN_HEADERS });
  if (message === "FORBIDDEN" || (error instanceof SensitiveVerificationError)) return NextResponse.json({ error: "Only administrators, acting as themselves, can manage agents." }, { status: 403, headers: AGENT_ADMIN_HEADERS });
  return NextResponse.json({ error: "The agent change could not be completed." }, { status: 500, headers: AGENT_ADMIN_HEADERS });
}
