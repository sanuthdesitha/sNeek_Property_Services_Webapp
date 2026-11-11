/**
 * Bulk actions on selected client reports: set visibility, regenerate with a
 * theme, delete. Each row runs the same single-report action the row buttons
 * use (./admin-report-actions), one at a time, and reports its own outcome:
 * one failure never hides another row's success. Delete requires an explicit
 * confirmation flag from the confirmation dialog.
 */
import { z } from "zod";
import { deleteReport, regenerateReport, ReportActionError, setReportVisibility } from "./admin-report-actions";

export const MAX_BULK_REPORTS = 50;
/** Regeneration renders a PDF per row, so fewer at once. */
export const MAX_BULK_REGENERATE = 20;

const jobIds = z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_BULK_REPORTS);

export const reportBulkSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("visibility"),
    jobIds,
    patch: z
      .object({
        clientVisible: z.boolean().optional(),
        cleanerVisible: z.boolean().optional(),
        laundryVisible: z.boolean().optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0, "Choose at least one visibility to change."),
  }).strict(),
  z.object({
    action: z.literal("regenerate"),
    jobIds: jobIds.max(MAX_BULK_REGENERATE),
    themeId: z.string().trim().min(1).max(64).nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("delete"),
    jobIds,
    confirm: z.literal(true),
  }).strict(),
]);

export type ReportBulkRequest = z.infer<typeof reportBulkSchema>;

export type ReportBulkOutcome = { jobId: string; ok: true } | { jobId: string; ok: false; status: number; error: string };

export type ReportBulkResult = {
  action: ReportBulkRequest["action"];
  results: ReportBulkOutcome[];
  succeeded: number;
  failed: number;
};

function failure(jobId: string, error: unknown): ReportBulkOutcome {
  if (error instanceof ReportActionError) return { jobId, ok: false, status: error.status, error: error.message };
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2025") return { jobId, ok: false, status: 404, error: "Report not found" };
  const message = error instanceof Error && error.message ? error.message : "The action failed.";
  return { jobId, ok: false, status: 400, error: message };
}

async function runOne(request: ReportBulkRequest, jobId: string, actorId: string): Promise<void> {
  if (request.action === "visibility") {
    await setReportVisibility(jobId, request.patch, actorId);
  } else if (request.action === "regenerate") {
    await regenerateReport(jobId, request.themeId ?? null);
  } else {
    await deleteReport(jobId);
  }
}

export async function runReportBulk(request: ReportBulkRequest, actorId: string): Promise<ReportBulkResult> {
  const unique = Array.from(new Set(request.jobIds));
  const results: ReportBulkOutcome[] = [];
  for (const jobId of unique) {
    try {
      await runOne(request, jobId, actorId);
      results.push({ jobId, ok: true });
    } catch (error) {
      results.push(failure(jobId, error));
    }
  }
  const succeeded = results.filter((row) => row.ok).length;
  return { action: request.action, results, succeeded, failed: results.length - succeeded };
}
