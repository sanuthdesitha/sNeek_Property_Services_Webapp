import "server-only";
import { z } from "zod";
import { checkCalendarMove } from "@/lib/calendar/check-move";
import type { CheckMoveResponse, MoveWarning } from "@/lib/calendar/types";
import { applyReschedule } from "@/lib/phase4/analytics";

/**
 * Jobs bulk Reschedule: one endpoint, two steps.
 *
 * preview: every selected job goes through the SAME read-only check a Calendar
 *   move uses (`checkCalendarMove`: the calendar's move rule, the reschedule
 *   service's window check, clashes and roster on the new day, the booking and
 *   notice warnings) with the new date and optional time shift. Nothing is
 *   written.
 * apply: each row is checked again (the world may have moved since the
 *   preview), then saved through the existing reschedule service
 *   (`applyReschedule`) with the `updatedAt` the preview saw as its stale-write
 *   guard, one job at a time, with a result per row. A refused or failed row
 *   is reported and left as it was; the page keeps it selected.
 *
 * No scheduling rule lives here: the check and the service decide.
 */
export const MAX_BULK_RESCHEDULE = 100;
export const BULK_RESCHEDULE_REASON = "Rescheduled in bulk from Jobs";

export const bulkRescheduleRequestSchema = z.object({
  mode: z.enum(["preview", "apply"]),
  jobIds: z.array(z.string().min(1).max(128)).min(1).max(MAX_BULK_RESCHEDULE),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Minutes to move each job's own start (and due) time; 0 or absent keeps times. */
  shiftMinutes: z.number().int().min(-720).max(720).optional(),
  /** apply only: job id → the `updatedAt` its preview row showed. */
  expectedUpdatedAt: z.record(z.string().datetime()).optional(),
}).strict();
export type BulkRescheduleRequest = z.infer<typeof bulkRescheduleRequestSchema>;

export type BulkPreviewRow = {
  jobId: string;
  propertyName: string;
  fromDate: string | null;
  toDate: string;
  movable: boolean;
  blockers: string[];
  /** Clashes, roster gaps and booking-driven notices for this job. */
  warnings: MoveWarning[];
  time: CheckMoveResponse["time"] | null;
  expectedUpdatedAt: string | null;
};

export type BulkApplyOutcome = "moved" | "refused" | "failed";
export type BulkApplyRow = { jobId: string; propertyName: string; outcome: BulkApplyOutcome; message: string };

type MoveChecker = typeof checkCalendarMove;
type Rescheduler = typeof applyReschedule;

/** Row-level warnings only; the shared notices are listed once by the page. */
function rowWarnings(check: CheckMoveResponse): MoveWarning[] {
  return check.warnings.filter((warning) => warning.kind !== "notice");
}

async function checkOne(jobId: string, request: BulkRescheduleRequest, check: MoveChecker): Promise<BulkPreviewRow> {
  const outcome = await check({ jobId, toDate: request.toDate, shiftMinutes: request.shiftMinutes ?? null });
  if (outcome.kind === "not_found") {
    return { jobId, propertyName: "Unknown job", fromDate: null, toDate: request.toDate, movable: false, blockers: ["This job no longer exists."], warnings: [], time: null, expectedUpdatedAt: null };
  }
  if (outcome.kind === "invalid") {
    return { jobId, propertyName: "Job", fromDate: null, toDate: request.toDate, movable: false, blockers: [outcome.message], warnings: [], time: null, expectedUpdatedAt: null };
  }
  const result = outcome.result;
  const reschedule = result.plan.reschedule;
  return {
    jobId,
    propertyName: result.propertyName,
    fromDate: result.fromDate,
    toDate: result.toDate,
    movable: result.blockers.length === 0 && reschedule !== null,
    blockers: result.blockers,
    warnings: rowWarnings(result),
    time: result.time ?? null,
    expectedUpdatedAt: reschedule?.expectedUpdatedAt ?? null,
  };
}

export async function previewBulkReschedule(request: BulkRescheduleRequest, check: MoveChecker = checkCalendarMove): Promise<BulkPreviewRow[]> {
  const ids = Array.from(new Set(request.jobIds));
  const rows: BulkPreviewRow[] = [];
  // Sequential: each check reads availability and the day's assignments.
  for (const jobId of ids) rows.push(await checkOne(jobId, request, check));
  return rows;
}

export async function applyBulkReschedule(
  request: BulkRescheduleRequest,
  userId: string,
  deps: { check?: MoveChecker; reschedule?: Rescheduler } = {},
): Promise<BulkApplyRow[]> {
  const check = deps.check ?? checkCalendarMove;
  const reschedule = deps.reschedule ?? applyReschedule;
  const results: BulkApplyRow[] = [];
  for (const jobId of Array.from(new Set(request.jobIds))) {
    const outcome = await check({ jobId, toDate: request.toDate, shiftMinutes: request.shiftMinutes ?? null });
    if (outcome.kind !== "ok") {
      results.push({ jobId, propertyName: "Job", outcome: "refused", message: outcome.kind === "invalid" ? outcome.message : "This job no longer exists." });
      continue;
    }
    const { result } = outcome;
    const plan = result.plan.reschedule;
    if (result.blockers.length > 0 || !plan) {
      results.push({ jobId, propertyName: result.propertyName, outcome: "refused", message: result.blockers.join(" ") || "Nothing would change." });
      continue;
    }
    // The preview's version guards the write: a job edited since then is refused by the service.
    const expected = request.expectedUpdatedAt?.[jobId] ?? plan.expectedUpdatedAt;
    try {
      await reschedule({
        jobId,
        date: plan.date,
        ...(plan.startTime !== undefined ? { startTime: plan.startTime, dueTime: plan.dueTime ?? null } : {}),
        ...(plan.endTime !== undefined ? { endTime: plan.endTime } : {}),
        userId,
        reason: BULK_RESCHEDULE_REASON,
        expectedUpdatedAt: expected,
      });
      results.push({ jobId, propertyName: result.propertyName, outcome: "moved", message: "Rescheduled." });
    } catch (error) {
      results.push({ jobId, propertyName: result.propertyName, outcome: "failed", message: error instanceof Error ? error.message : "The reschedule failed." });
    }
  }
  return results;
}
