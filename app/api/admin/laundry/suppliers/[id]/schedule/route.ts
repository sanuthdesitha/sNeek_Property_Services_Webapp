import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { PartnerScheduleError, updatePartnerSchedule } from "@/lib/laundry/partner-schedule-server";

export const dynamic = "force-dynamic";

/**
 * PATCH { pickupWeekdays, pickupWindowStart, pickupWindowEnd, dropWeekdays,
 * dropWindowStart, dropWindowEnd, expectedUpdatedAt? } — the laundry partner's
 * usual pickup / drop schedule (descriptive defaults; never changes a run or a
 * planning rule). ADMIN and OPS_MANAGER, as for editing the partner.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const schedule = await updatePartnerSchedule(session.user.id, params.id, await req.json());
    return NextResponse.json({ schedule });
  } catch (error: unknown) {
    if (error instanceof PartnerScheduleError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the days and times." }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Check the days and times." }, { status: 400 });
    const status = getApiErrorStatus(error, 500);
    return NextResponse.json({ error: status === 500 ? "The schedule could not be saved." : (error as Error).message }, { status });
  }
}
