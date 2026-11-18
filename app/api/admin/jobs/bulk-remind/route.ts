import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { resolveAppUrl } from "@/lib/app-url";
import { reminderInputSchema, sendBulkJobReminders, type BulkReminderRow, type BulkRemindResponse } from "@/lib/jobs/job-reminder";

/**
 * POST /api/admin/jobs/bulk-remind — remind the cleaners on several jobs in
 * one request. Each job goes through the same service as the single-job route
 * (same remindable states, transports and audit) and gets its own outcome:
 * requested / partial / failed / skipped (with the reason) / not found.
 * By email, a cleaner on two or more of the selected jobs gets ONE email
 * listing them all; each job's row still reports that email's outcome.
 * A requested push or an accepted email is not proof of delivery, and the
 * response says so per row.
 */
const bodySchema = reminderInputSchema.extend({
  jobIds: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Select jobs and a reminder method." }, { status: 400 });
    const { jobIds, method, note, idempotencyKey } = parsed.data;
    const context = { actorId: session.user.id, cleanerJobsUrl: resolveAppUrl("/cleaner/jobs", req) };

    const rows: BulkReminderRow[] = await sendBulkJobReminders(jobIds, { method, note, idempotencyKey }, context);
    const count = (outcome: BulkReminderRow["outcome"]) => rows.filter((row) => row.outcome === outcome).length;
    const body: BulkRemindResponse = {
      method,
      rows,
      summary: {
        requested: count("requested"),
        partial: count("partial"),
        failed: count("failed"),
        skipped: count("skipped"),
        notFound: count("not_found"),
      },
    };
    return NextResponse.json(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Reminders could not be sent." : message }, { status });
  }
}
