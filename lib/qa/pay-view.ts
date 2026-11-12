/**
 * QA Pay screen: the period headline and its breakdown (approved board "QA
 * portal", screen 4). Presentation of `getQaPaySummary` only: totals come from
 * the summary itself; nothing here re-prices an inspection.
 *
 * Rule from the board: an inspection whose rate is not set is shown as
 * "Office to fix", never as $0.00, and the headline says the period total is
 * incomplete while such a line exists. Plain module (server page and tests).
 */
import type { QaPayLine, QaPaySummary } from "@/lib/qa/pay";

export const OFFICE_TO_FIX = "Office to fix";

export function qaPayMoney(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A line still needs the office: its rate is missing and nothing has settled it. */
export function lineNeedsOffice(line: Pick<QaPayLine, "rateMissing" | "settlement">): boolean {
  return line.rateMissing && line.settlement !== "PAID";
}

/** What the amount column says for one inspection. */
export function qaPayLineAmount(line: Pick<QaPayLine, "rateMissing" | "settlement" | "amount">): string {
  return lineNeedsOffice(line) ? OFFICE_TO_FIX : qaPayMoney(line.amount);
}

export interface QaPayBreakdownRow {
  key: string;
  label: string;
  value: string;
  tone: "neutral" | "warning";
}

export interface QaPayHeadline {
  total: string;
  inspectionsLabel: string;
  /** Present while one or more inspections have no rate yet. */
  incompleteNote: string | null;
  breakdown: QaPayBreakdownRow[];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function buildQaPayHeadline(summary: Pick<QaPaySummary, "inspections" | "totals">): QaPayHeadline {
  const { totals } = summary;
  const officeLines = summary.inspections.filter(lineNeedsOffice).length;
  const priced = summary.inspections.length - officeLines;
  const breakdown: QaPayBreakdownRow[] = [
    { key: "priced", label: plural(priced, "priced inspection"), value: qaPayMoney(totals.inspectionPay), tone: "neutral" },
  ];
  if (totals.approvedAdjustments !== 0) {
    breakdown.push({ key: "credits", label: "Approved credits and adjustments", value: qaPayMoney(totals.approvedAdjustments), tone: "neutral" });
  }
  if (totals.pendingAdjustments > 0) {
    breakdown.push({ key: "pending", label: "Credits waiting for approval (not in the total)", value: qaPayMoney(totals.pendingAdjustments), tone: "neutral" });
  }
  if (officeLines > 0) {
    breakdown.push({ key: "office", label: `${plural(officeLines, "inspection")}, rate not set`, value: OFFICE_TO_FIX, tone: "warning" });
  }
  return {
    total: qaPayMoney(totals.total),
    inspectionsLabel: plural(totals.inspectionCount, "inspection"),
    incompleteNote:
      officeLines > 0
        ? `Not final: ${plural(officeLines, "inspection")} still need${officeLines === 1 ? "s" : ""} a rate from the office.`
        : null,
    breakdown,
  };
}
