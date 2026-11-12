import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { LeaveError, createLeave, listPersonLeave, removeLeave } from "@/lib/accounts/leave";

export const dynamic = "force-dynamic";

/**
 * /api/admin/users/:id/leave — leave and days off for one person.
 * ADMIN and OPS_MANAGER, like the person's office notes; under
 * /api/admin/users, so an operations manager also needs the accounts pack
 * (manage for POST/DELETE), enforced by the live session guard.
 *   GET                 recent and upcoming records
 *   POST   { startDate, endDate, kind, note? }
 *   DELETE ?leaveId=…   remove a record that has not ended (tombstone)
 */
function failure(err: unknown, fallback: string) {
  if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid dates." }, { status: 400 });
  if (err instanceof LeaveError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

const OFFICE = [Role.ADMIN, Role.OPS_MANAGER];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole(OFFICE);
    return NextResponse.json({ entries: await listPersonLeave(params.id) });
  } catch (err) {
    return failure(err, "Could not load leave.");
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(OFFICE);
    const entry = await createLeave(session.user.id, params.id, await req.json().catch(() => null));
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return failure(err, "Could not record the leave.");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(OFFICE);
    const leaveId = req.nextUrl.searchParams.get("leaveId")?.trim();
    if (!leaveId) return NextResponse.json({ error: "Choose the record to remove." }, { status: 400 });
    return NextResponse.json(await removeLeave(session.user.id, params.id, leaveId));
  } catch (err) {
    return failure(err, "Could not remove the leave.");
  }
}
