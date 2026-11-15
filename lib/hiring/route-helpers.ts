import "server-only";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import type { Session } from "next-auth";
import { requireRole } from "@/lib/auth/session";
import { resolveAccountCreator, type ResolvedAccountCreator } from "@/lib/accounts/account-creator";
import { HiringError } from "./hire";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * The live guard for every Hiring write: the session guard (account, roles and
 * the request path's pack, re-read now), then for an operations manager the
 * Hiring pack at Manage. Administrators never depend on packs.
 */
export async function requireHiringWriter(): Promise<{ session: Session; creator: ResolvedAccountCreator }> {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const creator = await resolveAccountCreator(session);
  if (!creator.heldRoles.includes("ADMIN") && !creator.impersonating && creator.hiringLevel !== "manage") {
    throw new HiringError(403, "Your access does not include managing Hiring.");
  }
  return { session, creator };
}

export function hiringErrorResponse(error: unknown, fallback: string) {
  if (error instanceof HiringError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401, headers: NO_STORE });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "You do not have access to Hiring." }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ error: fallback }, { status: 500, headers: NO_STORE });
}
