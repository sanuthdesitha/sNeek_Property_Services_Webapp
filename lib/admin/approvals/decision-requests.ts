/**
 * The single-decision request (route, method, body) that one approve or
 * decline stands for, per queue. Plain module: the bulk route runs these
 * through the existing route handlers, and the list's one-click "Approve"
 * sends the same request from the browser, so both match the side panel.
 */
import type { ApprovalsQueueKey, BulkDecision } from "./queues";

/** Which single-decision handler a row goes to. */
export type DecisionTarget =
  | "payAdjustment"
  | "timeAdjustment"
  | "timing"
  | "cleanerInvoice"
  | "clientApproval"
  | "jobTask"
  | "skip"
  | "qaRework"
  | "qaOutcome"
  | "qaIssue";

export type DecisionRequest = {
  target: DecisionTarget;
  /** The single route's path, used for the access check and the request URL. */
  path: string;
  method: "PATCH" | "POST";
  /** Route params passed to the handler ({ id }) — absent for collection routes. */
  params: { id: string } | null;
  body: Record<string, unknown>;
};

function noteFields(note: string | null | undefined, visible: boolean | undefined): Record<string, string> {
  const text = note?.trim();
  if (!text) return {};
  // adminNote is private; decisionMessage is what the payee reads.
  return visible ? { decisionMessage: text } : { adminNote: text };
}

/** The single-decision request a bulk row stands for. Pure; exported for tests. */
export function decisionRequestFor(
  queue: ApprovalsQueueKey,
  decision: BulkDecision,
  id: string,
  note?: string | null,
  noteVisibleToPayee?: boolean,
): DecisionRequest | null {
  const approve = decision === "approve";
  const trimmed = note?.trim() || undefined;
  switch (queue) {
    case "payAdjustments":
    case "rectificationAdjustments":
    case "bonusProposals":
      if (approve && queue === "payAdjustments") return null;
      return {
        target: "payAdjustment",
        path: `/api/admin/pay-adjustments/${id}`,
        method: "PATCH",
        params: { id },
        body: approve ? { status: "APPROVED" } : { status: "REJECTED", ...noteFields(note, noteVisibleToPayee) },
      };
    case "timeAdjustments":
      if (approve) return null;
      return { target: "timeAdjustment", path: `/api/admin/time-adjustments/${id}`, method: "PATCH", params: { id }, body: { status: "REJECTED", ...(trimmed ? { adminNote: trimmed } : {}) } };
    case "timingRequests":
      return { target: "timing", path: `/api/admin/job-early-checkouts/${id}`, method: "PATCH", params: { id }, body: { status: approve ? "APPROVED" : "DECLINED" } };
    case "cleanerInvoicePayClaims":
      if (approve) return null;
      return { target: "cleanerInvoice", path: `/api/admin/cleaner-invoices/${id}`, method: "PATCH", params: { id }, body: { status: "SUBMITTED" } };
    case "clientApprovals":
      return { target: "clientApproval", path: `/api/admin/client-approvals/${id}`, method: "PATCH", params: { id }, body: { status: approve ? "APPROVED" : "DECLINED" } };
    case "clientRequests":
    case "rescheduleRequests":
      return { target: "jobTask", path: `/api/admin/job-tasks/${id}`, method: "PATCH", params: { id }, body: { decision: approve ? "APPROVE" : "REJECT", ...(trimmed ? { note: trimmed } : {}) } };
    case "skipRequests":
      return { target: "skip", path: `/api/admin/jobs/${id}/skip`, method: "PATCH", params: { id }, body: { action: approve ? "approve" : "decline" } };
    case "qaReworkTransfers":
      return { target: "qaRework", path: `/api/admin/qa/rework-transfers/${id}`, method: "PATCH", params: { id }, body: { status: approve ? "APPROVED" : "REJECTED" } };
    case "qaOutcomes":
      if (!approve) return null;
      return { target: "qaOutcome", path: "/api/admin/qa/outcomes", method: "POST", params: null, body: { jobIds: [id] } };
    case "falseConfirmations":
      return { target: "qaIssue", path: `/api/admin/qa/issues/${id}`, method: "PATCH", params: { id }, body: { action: "falseConfirmation", decision: approve ? "CONFIRMED" : "REJECTED" } };
    default:
      return null;
  }
}

