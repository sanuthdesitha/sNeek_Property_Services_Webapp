/**
 * The one primary action each waiting request shows in the list.
 *
 * - "approve": the decision needs nothing chosen (or, for a pay request with a
 *   receipt, approves the asked amount after a confirm), sent to the same
 *   route as the side panel's Approve.
 * - "review": the decision needs input, evidence or a consequence spelled
 *   out first, so the side panel opens.
 * - "link": review-and-route queues go to where the work lives.
 *
 * Plain module; exported for tests.
 */
import { APPROVAL_QUEUES } from "@/lib/admin/approvals/queues";
import { decisionRequestFor } from "@/lib/admin/approvals/decision-requests";
import { money, type ApprovalQueueRow } from "@/lib/admin/approvals/rows";

export type RowPrimary =
  | { kind: "approve"; label: string; url: string; method: "PATCH" | "POST"; body: object; successMsg: string; confirm: string | null }
  | { kind: "review"; label: string }
  | { kind: "link"; label: string; href: string };

/** Approving these cancels or penalises something, so it is always reviewed first. */
const ALWAYS_REVIEW = new Set(["skipRequests", "falseConfirmations"]);

export function primaryActionFor(row: ApprovalQueueRow): RowPrimary {
  const queue = APPROVAL_QUEUES[row.queue];
  if (row.queue === "continuations") return { kind: "link", label: "Review job", href: `/v2/admin/jobs/${row.jobId ?? ""}` };
  if (row.queue === "flaggedLaundry") return { kind: "link", label: "Open laundry", href: "/v2/admin/laundry" };

  if (row.queue === "payAdjustments") {
    const awaitingClient = row.record.clientApproval?.status === "PENDING";
    if (!row.hasEvidence || awaitingClient || row.askedAmount == null || row.askedAmount <= 0) return { kind: "review", label: "Review" };
    return {
      kind: "approve",
      label: "Approve",
      url: `/api/admin/pay-adjustments/${row.id}`,
      method: "PATCH",
      body: { status: "APPROVED", approvedAmount: row.askedAmount },
      successMsg: "Pay request approved",
      confirm: `Approve ${money(row.askedAmount)} as asked for ${row.who}? To change the amount or add a note, use Review.`,
    };
  }

  if (!queue.bulk.approve.allowed || ALWAYS_REVIEW.has(row.queue) || !row.hasEvidence) return { kind: "review", label: "Review" };
  const request = decisionRequestFor(row.queue, "approve", row.id);
  if (!request) return { kind: "review", label: "Review" };
  return {
    kind: "approve",
    label: queue.bulk.approve.label === "Mark handled" ? "Mark handled" : "Approve",
    url: request.path,
    method: request.method,
    body: request.body,
    successMsg: `${queue.noun.charAt(0).toUpperCase()}${queue.noun.slice(1)} approved`,
    confirm: null,
  };
}
