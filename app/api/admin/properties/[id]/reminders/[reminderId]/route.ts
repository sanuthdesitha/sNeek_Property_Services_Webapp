/**
 * PATCH /api/admin/properties/[id]/reminders/[reminderId] — edit or end one
 * reminder for cleaners: { action: "edit", expectedUpdatedAt, reminder } or
 * { action: "end", expectedUpdatedAt }. A reminder changed meanwhile is
 * refused (409). Ending keeps the row and its confirmations.
 *
 * Same guard as the list: ADMIN or OPS_MANAGER (Properties pack at manage),
 * refused while testing as another person; audited with the actual actor.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { patchPropertyReminder } from "@/lib/properties/reminders/service";
import { privateHeaders, refuse, reminderErrorResponse } from "@/lib/properties/reminders/http";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; reminderId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return refuse(403, "Stop testing as another person before you change a reminder.", "IMPERSONATION_NOT_ALLOWED");
    const role = session.user.role === Role.ADMIN ? Role.ADMIN : Role.OPS_MANAGER;
    const body = await req.json();
    const result = await patchPropertyReminder({ id: session.user.id, role }, params.id, params.reminderId, body);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    return reminderErrorResponse(error, "Could not save the change.");
  }
}
