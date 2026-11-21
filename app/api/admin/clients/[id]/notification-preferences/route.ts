import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { legacyClientChanges, legacyClientPreferenceRow, legacyClientPreferenceSchema } from "@/lib/notifications/personal/legacy-client";
import { applySwitchChanges } from "@/lib/notifications/personal/write";

/**
 * The older per-client preference route (classic notifications page and the
 * control center), kept compatible. Reads: ADMIN and OPS_MANAGER. Changes:
 * ADMIN only (2026-11-21; OPS_MANAGER could change them before), never while
 * testing as someone else, through the shared switch path (stamped, audited).
 * A read no longer creates a row.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    return NextResponse.json(await legacyClientPreferenceRow(params.id));
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Failed" : err.message }, { status });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) {
      return NextResponse.json({ error: "Notification switches cannot be changed while testing as someone else." }, { status: 403 });
    }
    const body = legacyClientPreferenceSchema.parse(await req.json());
    const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    await applySwitchChanges({
      subject: { kind: "CLIENT", id: params.id },
      actor: { id: session.user.id, name: session.user.name ?? null, role: String(session.user.role) },
      expectedRevision: null,
      changes: legacyClientChanges(body),
    });
    return NextResponse.json(await legacyClientPreferenceRow(params.id));
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
