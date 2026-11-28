/**
 * Settings › System › Pilot features (2026-11-28).
 *
 * GET    every pilot, its state, scope and who last changed it. ADMIN, and
 *        OPS_MANAGER with the Settings pack (view only).
 * PATCH  { key, mode, userIds?, propertyIds? } — ADMIN only, refused while
 *        testing as someone else; audited with the actual actor.
 *
 * Live session and role on every call (requireRole → enforceOpsRequest).
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PILOTS, pilotUpdateInput, type PilotKey } from "@/lib/pilots/registry";
import { clearPilotCache, loadPilotState, savePilotSetting } from "@/lib/pilots/state";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

function failure(err: unknown) {
  if (err instanceof ZodError) return refuse(400, "Choose a valid state for the pilot.", "INVALID_INPUT");
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
  if (message === "FORBIDDEN") return refuse(403, "You cannot see pilot features.", "FORBIDDEN");
  return refuse(500, "Could not load or save pilot features. Nothing was changed.", "FAILED");
}

async function payload(canEdit: boolean) {
  clearPilotCache();
  const state = await loadPilotState();
  const ids = new Set<string>();
  const propertyIds = new Set<string>();
  for (const pilot of PILOTS) {
    const setting = state.pilots[pilot.key];
    if (setting.changedById) ids.add(setting.changedById);
    setting.userIds.forEach((id) => ids.add(id));
    setting.propertyIds.forEach((id) => propertyIds.add(id));
  }
  const [users, properties] = await Promise.all([
    ids.size ? db.user.findMany({ where: { id: { in: Array.from(ids) } }, select: { id: true, name: true, email: true } }) : [],
    propertyIds.size ? db.property.findMany({ where: { id: { in: Array.from(propertyIds) } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((user) => [user.id, user.name || user.email || user.id]));
  const propertyName = new Map(properties.map((property) => [property.id, property.name]));
  return {
    readable: state.readable,
    canEdit,
    pilots: PILOTS.map((pilot) => {
      const setting = state.pilots[pilot.key as PilotKey];
      return {
        ...pilot,
        unreadable: state.unreadable.includes(pilot.key),
        mode: setting.mode,
        users: setting.userIds.map((id) => ({ id, name: userName.get(id) ?? "Unknown person" })),
        properties: setting.propertyIds.map((id) => ({ id, name: propertyName.get(id) ?? "Unknown property" })),
        onSince: setting.onSince,
        changedAt: setting.changedAt,
        changedBy: setting.changedById ? userName.get(setting.changedById) ?? "Unknown person" : null,
      };
    }),
  };
}

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await payload(session.user.role === Role.ADMIN && !session.impersonation), { headers: privateHeaders });
  } catch (err) {
    return failure(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role !== Role.ADMIN) return refuse(403, "Only an administrator can change pilot features.", "ADMIN_ONLY");
    if (session.impersonation) return refuse(403, "Stop testing as another person before you change pilot features.", "IMPERSONATION_NOT_ALLOWED");
    const input = pilotUpdateInput.parse(await req.json().catch(() => null));
    if (input.mode === "SCOPED" && input.userIds.length === 0 && input.propertyIds.length === 0) {
      return refuse(400, "Choose at least one person or property, or switch the pilot on for everyone.", "EMPTY_SCOPE");
    }
    await savePilotSetting({ id: session.user.id, role: Role.ADMIN }, input);
    return NextResponse.json(await payload(true), { headers: privateHeaders });
  } catch (err) {
    return failure(err);
  }
}
