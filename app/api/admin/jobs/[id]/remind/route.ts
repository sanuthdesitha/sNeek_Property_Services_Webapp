import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveAppUrl } from "@/lib/app-url";
import { bulkReminderRow, reminderInputSchema, sendJobReminder } from "@/lib/jobs/job-reminder";

/**
 * Manual "Send reminder" for an unfinished job. The rules and the audit live in
 * `lib/jobs/job-reminder.ts`, shared with the bulk route; this route keeps its
 * original responses: 404 not found, 409 `notRemindable` for a job outside
 * PAUSED / IN_PROGRESS / SUBMITTED, 400 when nobody is assigned. `sent` keeps
 * its name for compatibility; `deliveryState` and `message` say that a push is
 * queued and an email only provider-accepted, never delivered.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = reminderInputSchema.parse(await req.json());
    const result = await sendJobReminder(params.id, body, {
      actorId: session.user.id,
      cleanerJobsUrl: resolveAppUrl("/cleaner/jobs", req),
    });
    if (result.kind === "not_found") return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (result.kind === "not_remindable") {
      return NextResponse.json({ error: result.error, notRemindable: true }, { status: 409 });
    }
    if (result.kind === "no_cleaners") return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({
      sent: result.sent,
      failed: result.failed,
      deliveryState: result.deliveryState,
      message: bulkReminderRow(result, body.method).message,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
