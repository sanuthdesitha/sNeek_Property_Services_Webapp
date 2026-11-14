import "server-only";
/**
 * Shared by the Sending safeguards routes: who may change what, and the
 * response body every route returns (the fresh overview).
 *
 * Reading: ADMIN, and OPS_MANAGER with the notifications (communications)
 * pack (the shared middleware checks the pack; the route re-checks the role).
 * Changing anything: ADMIN only, never while impersonating (an operations
 * manager is not an administrator here). Limits and the emergency stop also
 * need the person's own PIN (verifySensitiveAction, audited).
 */
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { buildSafeguardsOverview } from "./overview";
import type { SafeguardsResponse } from "./overview-types";

export const SAFEGUARD_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

type Session = { user: { role: Role | string }; impersonation?: unknown };

export function manageRefusal(session: Session): string | null {
  if (session.impersonation) return "Sending safeguards cannot be changed while testing as someone else.";
  if (session.user.role !== Role.ADMIN) return "Only an administrator can change the sending safeguards.";
  return null;
}

export async function safeguardsResponse(session: Session, status = 200): Promise<NextResponse> {
  const overview = await buildSafeguardsOverview();
  const readOnlyReason = manageRefusal(session);
  const body: SafeguardsResponse = { ...overview, canManage: readOnlyReason === null, readOnlyReason };
  return NextResponse.json(body, { status, headers: SAFEGUARD_HEADERS });
}

export function refusal(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: SAFEGUARD_HEADERS });
}
