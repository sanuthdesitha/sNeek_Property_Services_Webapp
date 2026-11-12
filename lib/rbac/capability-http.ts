import "server-only";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { can, CapabilityDenied } from "./can";
import type { CapabilityKey } from "./capabilities";

/**
 * For a route that already passed its live session/role guard: a 403
 * response when the effective identity lacks any of these capabilities,
 * otherwise null. Administrators always pass (they never read a pack).
 */
export async function capabilityRefusal(session: Session, keys: readonly CapabilityKey[]): Promise<NextResponse | null> {
  for (const key of keys) {
    if (!(await can(session, key))) {
      const denied = new CapabilityDenied(key);
      return NextResponse.json({ error: denied.message, code: "CAPABILITY_REQUIRED", capability: key }, { status: 403 });
    }
  }
  return null;
}
