/**
 * POST /api/cleaner/jobs/[id]/attendance-notice — "I can't attend" or
 * "Running late" before the clean (pilot "Before-you-start extras"):
 *   { kind: "CANT_ATTEND", requestKey, reason } or
 *   { kind: "RUNNING_LATE", requestKey, reason, minutes }.
 *
 * Live session and role; the cleaner must hold an assignment and not have
 * clocked in. Refused while an administrator is testing as the cleaner and,
 * with 409 PILOT_OFF, where the pilot is off. Tells the office only; the job,
 * assignment and pay are unchanged. Queued is not delivered: the response
 * reports the inbox state.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isPilotOn } from "@/lib/pilots/state";
import { deliverInboxIntentsNow } from "@/lib/notifications/inline-dispatch";
import { AttendanceNoticeError, sendAttendanceNotice } from "@/lib/jobs/attendance-notice";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    if (session.impersonation) return refuse(403, "Only the cleaner can send this.", "IMPERSONATION_NOT_ALLOWED");
    const job = await db.job.findUnique({ where: { id: params.id }, select: { propertyId: true } });
    if (!job) return refuse(404, "Job not found.", "NOT_FOUND");
    if (!(await isPilotOn("before-start-extras", { userId: session.user.id, propertyId: job.propertyId }))) {
      return refuse(409, "This is not switched on for this job. Call the office.", "PILOT_OFF");
    }
    const timeZone = (await getAppSettings().catch(() => null))?.timezone ?? "Australia/Sydney";
    const body = await req.json().catch(() => null);
    const result = await sendAttendanceNotice({ id: session.user.id }, params.id, body, timeZone);
    const states = result.intentIds.length > 0 ? await deliverInboxIntentsNow(result.intentIds) : new Map();
    const inInbox = Array.from(states.values()).filter((state) => state.state === "inbox_available").length;
    return NextResponse.json({ outcome: result.outcome, office: { queued: result.intentIds.length, inInbox } }, { headers: privateHeaders });
  } catch (err) {
    if (err instanceof AttendanceNoticeError) return refuse(err.status, err.message, err.code);
    if (err instanceof ZodError) return refuse(400, "Give a short reason (and how many minutes late, 5 to 240).", "INVALID_INPUT");
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
    if (message === "FORBIDDEN") return refuse(403, "You cannot do this.", "FORBIDDEN");
    return refuse(500, "Could not reach the office. Your note is kept; try again or call the office.", "FAILED");
  }
}
