/** Limits and result shape of POST /api/admin/reports/bulk. Pure: safe in the browser. */
export const MAX_BULK_REPORTS = 50;
/** Regeneration renders a PDF per row, so fewer at once. */
export const MAX_BULK_REGENERATE = 20;

export type ReportBulkAction = "visibility" | "regenerate" | "delete";

export type ReportBulkOutcome = { jobId: string; ok: true } | { jobId: string; ok: false; status: number; error: string };

export type ReportBulkResult = {
  action: ReportBulkAction;
  results: ReportBulkOutcome[];
  succeeded: number;
  failed: number;
};
