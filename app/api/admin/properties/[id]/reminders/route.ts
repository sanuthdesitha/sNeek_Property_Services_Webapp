/**
 * GET  /api/admin/properties/[id]/reminders — the office's reminders for
 *      cleaners at this property (active, and ended in the last 90 days),
 *      the cleaners to choose from and whether the pilot shows them.
 * POST /api/admin/properties/[id]/reminders — write one by hand.
 *
 * Smart property reminders, slice A (2026-11-28). ADMIN or OPS_MANAGER on the
 * live session; requireRole re-reads the operations policy, so an operations
 * manager needs the Properties pack (read to view, manage to write). Writing
 * is refused while testing as another person, so the audit names the actual
 * actor. Works whatever the pilot state; cleaners see reminders only while
 * the "Property reminders" pilot is on for them or the property.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createPropertyReminder, listPropertyReminders } from "@/lib/properties/reminders/service";
import { privateHeaders, refuse, reminderErrorResponse } from "@/lib/properties/reminders/http";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await listPropertyReminders(params.id), { headers: privateHeaders });
  } catch (error) {
    return reminderErrorResponse(error, "Could not load the reminders.");
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return refuse(403, "Stop testing as another person before you write a reminder.", "IMPERSONATION_NOT_ALLOWED");
    const role = session.user.role === Role.ADMIN ? Role.ADMIN : Role.OPS_MANAGER;
    const body = await req.json();
    const created = await createPropertyReminder({ id: session.user.id, role }, params.id, body);
    return NextResponse.json(created, { status: 201, headers: privateHeaders });
  } catch (error) {
    return reminderErrorResponse(error, "Could not save the reminder.");
  }
}
