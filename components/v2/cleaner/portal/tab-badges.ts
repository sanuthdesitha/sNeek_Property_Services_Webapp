/**
 * Badge numbers for the cleaner's five phone tabs. Plain module (shared by the
 * client layout and tests). A badge means "something needs you": a count that
 * could not be read is absent, never zero-as-success.
 */
import { CLEANER_ROOT } from "@/components/v2/cleaner/portal/portal-nav";

interface AskSummaryRow {
  state?: unknown;
}

/** Asks still waiting for the cleaner's yes or no; null when the body is not a list. */
export function countWaitingAsks(body: unknown): number | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { asks?: unknown }).asks)) return null;
  const asks = (body as { asks: AskSummaryRow[] }).asks;
  return asks.filter((ask) => Boolean(ask) && ask.state === "ASKED").length;
}

export interface CleanerBadgeInputs {
  /** Attention counts keyed by the old nav hrefs (GET /api/cleaner/attention-counts). */
  attention: Record<string, number>;
  maintenanceCount: number;
  waitingAsks: number;
}

/** Tab href → badge. Rail entries keep their own per-href counts. */
export function cleanerTabBadges({ attention, maintenanceCount, waitingAsks }: CleanerBadgeInputs): Record<string, number> {
  const read = (href: string) => Math.max(0, attention[href] ?? 0);
  return {
    [CLEANER_ROOT]: read(CLEANER_ROOT),
    [`${CLEANER_ROOT}/jobs`]: read(`${CLEANER_ROOT}/jobs`),
    [`${CLEANER_ROOT}/supplies`]: Math.max(0, waitingAsks),
    [`${CLEANER_ROOT}/pay`]: read(`${CLEANER_ROOT}/pay-requests`),
    [`${CLEANER_ROOT}/more`]: read(`${CLEANER_ROOT}/quality`) + Math.max(0, maintenanceCount),
  };
}
