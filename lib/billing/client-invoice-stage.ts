/**
 * Which of the five invoice stages (Draft, Approved, Sent to client, In Xero,
 * Paid) an invoice has reached, from stored state only.
 *
 * - Approval is optional (DRAFT may be sent or paid directly) and is not
 *   recorded once the status moves on, so past it the stage reads "passed".
 * - "In Xero" is done only when Xero returned an invoice id. An open
 *   reservation reads "pending", never done, noted "Push pending" or "Push
 *   failed"; a done stage is noted "Synced" or "Not yet checked" from the pull.
 * - A paid invoice that was never emailed shows "Sent to client" as skipped.
 * - VOID replaces the bar with a terminal state.
 *
 * Pure: safe in client components and tests.
 */
import type { EStage } from "@/components/v2/ui/stage-bar";
import type { ClientInvoiceListRow } from "./client-invoice-list-types";

export type StageFacts = Pick<ClientInvoiceListRow, "status" | "sentAt" | "xeroInvoiceId" | "xeroState"> &
  Partial<Pick<ClientInvoiceListRow, "xeroSync" | "xeroPushFailure">>;

export type InvoiceStageView =
  | { terminal: { title: string; description: string }; stages: [] }
  | { terminal: null; stages: EStage[] };

function approvedStage(status: StageFacts["status"]): EStage {
  if (status === "APPROVED") return { key: "approved", label: "Approved", state: "current" };
  if (status === "DRAFT") return { key: "approved", label: "Approved", state: "todo" };
  return { key: "approved", label: "Approved", state: "passed" };
}

function sentStage(facts: StageFacts): EStage {
  const base = { key: "sent", label: "Sent to client" };
  if (facts.status === "SENT") return { ...base, state: "current" };
  if (facts.status === "PART_PAID" || facts.status === "PAID") {
    return facts.sentAt ? { ...base, state: "done" } : { ...base, state: "skipped", note: "Not sent" };
  }
  return { ...base, state: "todo" };
}

function xeroStage(facts: StageFacts): EStage {
  const base = { key: "xero", label: "In Xero" };
  if (facts.xeroInvoiceId) {
    // Done = Xero returned an id. The note is the last status pull, when there is one.
    const sync = facts.xeroSync?.state;
    if (sync === "NEEDS_REVIEW") return { ...base, state: "done", note: "Needs review" };
    if (sync === "UNKNOWN") return { ...base, state: "done", note: "State unknown" };
    if (sync === "PAID_IN_XERO") return { ...base, state: "done", note: "Paid in Xero" };
    if (sync === "IN_XERO") return { ...base, state: "done", note: "Synced" };
    return { ...base, state: "done", note: "Not yet checked" };
  }
  // The same states as the list's Xero column (client-invoice-xero-display.ts).
  if (facts.xeroState === "PENDING") return { ...base, state: "pending", note: facts.xeroPushFailure ? "Push failed" : "Push pending" };
  return { ...base, state: "todo" };
}

function paidStage(status: StageFacts["status"]): EStage {
  const base = { key: "paid", label: "Paid" };
  if (status === "PAID") return { ...base, state: "done" };
  if (status === "PART_PAID") return { ...base, state: "current", note: "Part paid" };
  return { ...base, state: "todo" };
}

export function clientInvoiceStages(facts: StageFacts): InvoiceStageView {
  if (facts.status === "VOID") {
    return {
      terminal: {
        title: "Void",
        description: facts.xeroInvoiceId
          ? "Cancelled after its correction was reconciled in Xero. It is no longer owed."
          : "Cancelled. It is no longer owed and its work can be billed on a new invoice.",
      },
      stages: [],
    };
  }
  return {
    terminal: null,
    stages: [
      { key: "draft", label: "Draft", state: facts.status === "DRAFT" ? "current" : "done" },
      approvedStage(facts.status),
      sentStage(facts),
      xeroStage(facts),
      paidStage(facts.status),
    ],
  };
}
