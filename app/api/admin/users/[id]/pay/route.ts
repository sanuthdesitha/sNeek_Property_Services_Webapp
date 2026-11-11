import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { PayRateError, payRateSchema, updateHourlyRate } from "@/lib/accounts/pay-rate";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users/:id/pay  { hourlyRate }
 *
 * ADMIN only — OPS_MANAGER is refused (403) like every other pay-setting
 * write. Changes only User.hourlyRate (see lib/accounts/pay-rate for exactly
 * which pay computations read it); audited with the old and new value.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = payRateSchema.parse(await req.json().catch(() => null));
    const result = await updateHourlyRate(session.user.id, params.id, body.hourlyRate);
    return NextResponse.json({ id: result.id, hourlyRate: result.after, previousHourlyRate: result.before, changed: result.changed });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid rate." }, { status: 400 });
    if (err instanceof PayRateError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
    return NextResponse.json({ error: "Could not change the rate." }, { status: 500 });
  }
}
