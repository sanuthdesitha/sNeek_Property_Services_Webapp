/**
 * Shapes shared by the Xero status pull, its route and the screen. No server
 * imports, so client components can use them.
 */
import type { XeroSyncState } from "./client-invoice-xero-sync-rules";

/**
 * recorded: Xero payments were recorded here. in-xero / paid-in-xero: Xero
 * agrees and nothing needed recording. needs-review: left alone, see reason.
 * unknown: Xero could not be read; nothing changed. skipped: not checked.
 */
export type XeroSyncOutcome = "recorded" | "in-xero" | "paid-in-xero" | "needs-review" | "unknown" | "skipped";

export type XeroSyncRowResult = {
  id: string;
  invoiceNumber: string | null;
  outcome: XeroSyncOutcome;
  reason?: string;
  paymentsRecorded: number;
  state?: XeroSyncState;
};

export type XeroSyncRunSummary = {
  /** Set when nothing was checked because Xero is not connected. */
  skipped?: "not-connected";
  results: XeroSyncRowResult[];
  counts: Record<XeroSyncOutcome, number>;
  /** Eligible documents left for the next run (scheduled runs only). */
  remaining: number;
};

export const XERO_SYNC_MAX_IDS = 50;

export const XERO_SYNC_OUTCOME_LABEL: Record<XeroSyncOutcome, string> = {
  recorded: "Payment recorded from Xero",
  "in-xero": "In Xero, nothing to record",
  "paid-in-xero": "Paid in Xero (recorded)",
  "needs-review": "Needs review",
  unknown: "Xero state unknown",
  skipped: "Not checked",
};
