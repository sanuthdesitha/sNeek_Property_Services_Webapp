/**
 * Visibility for the client portal's list responses.
 *
 * The single-job response already hides cleaner names, laundry costs, laundry
 * photos and report downloads when the office switches them off
 * (`projectClientJob`). The list endpoints and list pages returned the raw
 * rows, so the same switches did nothing there. These projections apply the
 * same rules to lists. Pure, so the rules are testable without a database.
 */

import type { AppSettings } from "@/lib/settings";

export type ClientListVisibility = Pick<
  AppSettings["clientPortalVisibility"],
  "showCleanerNames" | "showLaundryUpdates" | "showLaundryCosts" | "showLaundryImages" | "showReportDownloads"
>;

type LaundryConfirmationRow = {
  photoUrl?: string | null;
  notes?: string | null;
  meta?: unknown;
};

const COST_META_KEY = /price|cost|amount|supplier|receipt|invoice/i;
const IMAGE_META_KEY = /photo|image/i;

/** Drops cost and image entries from a confirmation's parsed notes. */
function projectConfirmationMeta(meta: unknown, visibility: ClientListVisibility): unknown {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta ?? null;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (!visibility.showLaundryCosts && COST_META_KEY.test(key)) continue;
    if (!visibility.showLaundryImages && IMAGE_META_KEY.test(key)) continue;
    kept[key] = value;
  }
  return kept;
}

export function projectClientLaundryConfirmation<T extends LaundryConfirmationRow>(
  confirmation: T,
  visibility: ClientListVisibility,
): T {
  return {
    ...confirmation,
    photoUrl: visibility.showLaundryImages ? confirmation.photoUrl ?? null : null,
    // Raw notes are free-form JSON and may carry amounts.
    notes: visibility.showLaundryCosts ? confirmation.notes ?? null : null,
    meta: projectConfirmationMeta(confirmation.meta, visibility),
  };
}

type LaundryTaskRow = { confirmations: LaundryConfirmationRow[] };

export function projectClientLaundryList<T extends LaundryTaskRow>(rows: T[], visibility: ClientListVisibility): T[] {
  if (!visibility.showLaundryUpdates) return [];
  return rows.map((row) => ({
    ...row,
    confirmations: row.confirmations.map((confirmation) => projectClientLaundryConfirmation(confirmation, visibility)),
  }));
}

type JobListRow = {
  assignments: unknown[];
  laundryTask: LaundryTaskRow | null;
};

export function projectClientJobList<T extends JobListRow>(rows: T[], visibility: ClientListVisibility): T[] {
  return rows.map((row) => ({
    ...row,
    assignments: visibility.showCleanerNames ? row.assignments : [],
    laundryTask:
      visibility.showLaundryUpdates && row.laundryTask
        ? {
            ...row.laundryTask,
            confirmations: row.laundryTask.confirmations.map((confirmation) =>
              projectClientLaundryConfirmation(confirmation, visibility),
            ),
          }
        : null,
  }));
}

/** Report rows keep their content; the download link follows its own switch. */
export function projectClientReportList<T extends { pdfUrl?: string | null }>(
  rows: T[],
  visibility: ClientListVisibility,
): T[] {
  if (visibility.showReportDownloads) return rows;
  return rows.map((row) => ({ ...row, pdfUrl: null }));
}
