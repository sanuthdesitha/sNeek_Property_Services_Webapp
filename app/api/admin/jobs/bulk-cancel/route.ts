import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { JobCancelError } from "@/lib/jobs/cancel";
import { cancelJobAndNotify } from "@/lib/jobs/cancel-flow";
import { cancelActor, cancelFailure } from "@/lib/jobs/cancel-http";
import { CANCEL_REASON_MAX } from "@/lib/jobs/cancel-rules";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    jobIds: z.array(z.string().trim().min(1).max(200)).min(1, "Select at least one job.").max(100, "Cancel at most 100 jobs at a time."),
    reason: z.string().trim().min(1, "Give a reason for cancelling.").max(CANCEL_REASON_MAX),
  })
  .strict();

export type BulkCancelRow = { jobId: string; outcome: "cancelled" | "refused"; message: string };

/**
 * POST /api/admin/jobs/bulk-cancel  { jobIds, reason }
 * Runs each job through the same single-job cancel (rules, refusals, notice,
 * audit), one at a time, and answers one outcome per job. A refusal never
 * stops the others.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => null));
    const actor = cancelActor(session);
    const rows: BulkCancelRow[] = [];
    for (const jobId of Array.from(new Set(body.jobIds))) {
      try {
        const result = await cancelJobAndNotify(jobId, { reason: body.reason }, actor);
        rows.push({ jobId, outcome: "cancelled", message: result.noticeError ?? (result.released.length ? `Cancelled; ${result.released.length} cleaner${result.released.length === 1 ? "" : "s"} released.` : "Cancelled.") });
      } catch (error) {
        rows.push({ jobId, outcome: "refused", message: error instanceof JobCancelError ? error.message : "Could not cancel this job." });
      }
    }
    return NextResponse.json({ rows });
  } catch (err) {
    return cancelFailure(err, "Could not cancel the jobs.");
  }
}
