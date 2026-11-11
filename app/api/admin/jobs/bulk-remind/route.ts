import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { resolveAppUrl } from "@/lib/app-url";
import { bulkReminderRow, reminderInputSchema, sendJobReminder, type BulkReminderRow, type BulkRemindResponse } from "@/lib/jobs/job-reminder";

/**
 * POST /api/admin/jobs/bulk-remind — remind the cleaners on several jobs in
 * one request. Each job goes through the same service as the single-job route
 * (same remindable states, transports and audit) and gets its own outcome:
 * requested / partial / failed / skipped (with the reason) / not found.
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
    const { jobIds, method, note } = parsed.data;
    const context = { actorId: session.user.id, cleanerJobsUrl: resolveAppUrl("/cleaner/jobs", req) };

    const rows: BulkReminderRow[] = [];
    // Sequential: each job already fans out to its cleaners; this keeps the
    // provider load the same as the single-job route used one at a time.
    for (const jobId of Array.from(new Set(jobIds))) {
      try {
        rows.push(bulkReminderRow(await sendJobReminder(jobId, { method, note }, context), method));
      } catch {
        rows.push({ jobId, label: jobId, outcome: "failed", requested: [], failed: [], message: "The reminder could not be sent. Try this job again." });
      }
    }
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
