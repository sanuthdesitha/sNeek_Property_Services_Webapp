import "server-only";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsPolicy } from "@/lib/rbac/ops-access";
import { resolveOpsLevels } from "@/lib/rbac/ops-policy";
import type { OpsFeature } from "@/lib/rbac/ops-catalog";
import { AssistantInputError } from "./explain-and-draft";

export const ASSISTANT_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Office assistant features run as the signed-in person, never while testing as
 * someone (the request would send another person's view to an AI provider).
 */
export async function requireAssistantUser(roles: Role[] = [Role.ADMIN, Role.OPS_MANAGER]) {
  const session = await requireRole(roles);
  if (session.impersonation) throw new AssistantInputError(403, "AI help is unavailable while testing as someone.");
  return session;
}

/** ADMIN reads every area; an operations manager only areas at read or above in their live access. */
export async function canReadArea(session: { user: { id: string; role: string; heldRoles?: string[] } }, area: OpsFeature): Promise<boolean> {
  const roles = session.user.heldRoles ?? [session.user.role];
  if (roles.includes(Role.ADMIN)) return true;
  if (!roles.includes(Role.OPS_MANAGER)) return false;
  return resolveOpsLevels(await getOpsPolicy(), session.user.id)[area] !== "off";
}

export function assistantFailure(error: unknown, fallback: string) {
  if (error instanceof AssistantInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers: ASSISTANT_HEADERS });
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: ASSISTANT_HEADERS });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "Your access does not include this." }, { status: 403, headers: ASSISTANT_HEADERS });
  return NextResponse.json({ error: fallback }, { status: 502, headers: ASSISTANT_HEADERS });
}
