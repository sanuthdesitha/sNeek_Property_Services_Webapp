import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { PayRateError, removeFuturePayRate, updateHourlyRate } from "@/lib/accounts/pay-rate";
import { listPayRateHistory } from "@/lib/accounts/pay-rate-history";
import { payRateChangeSchema } from "@/lib/accounts/pay-rate-rules";

export const dynamic = "force-dynamic";

/**
 * /api/admin/users/:id/pay — the one Pay editor's route.
 *
 *  GET     rate history (ADMIN, OPS_MANAGER — the same people who see the rate
 *          in the person panel today).
 *  PATCH   { hourlyRate, appliesFrom? }  ADMIN only — OPS_MANAGER is refused
 *          (403) like every other pay-setting write. appliesFrom defaults to
 *          today (Sydney); never a past day. See lib/accounts/pay-rate.
 *  DELETE  ?entryId=…  ADMIN only: remove a rate that has not started yet.
 */
function failure(err: unknown, fallback: string) {
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid rate." }, { status: 400 });
  if (err instanceof PayRateError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await listPayRateHistory(params.id));
  } catch (err: unknown) {
    return failure(err, "Could not load the rate history.");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = payRateChangeSchema.parse(await req.json().catch(() => null));
    const result = await updateHourlyRate(session.user.id, params.id, body.hourlyRate, { appliesFrom: body.appliesFrom });
    return NextResponse.json({
      id: result.id,
      hourlyRate: result.after,
      previousHourlyRate: result.before,
      appliesFrom: result.appliesFrom,
      entryId: result.entryId,
      replacedEntryId: result.replacedEntryId,
      changed: result.changed,
    });
  } catch (err: unknown) {
    return failure(err, "Could not change the rate.");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const entryId = req.nextUrl.searchParams.get("entryId")?.trim();
    if (!entryId) return NextResponse.json({ error: "Choose the scheduled rate to remove." }, { status: 400 });
    return NextResponse.json(await removeFuturePayRate(session.user.id, params.id, entryId));
  } catch (err: unknown) {
    return failure(err, "Could not remove the scheduled rate.");
  }
}
