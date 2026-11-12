/**
 * Approve or decline a continuation request: the same call the old inline
 * ContinuationDecisions list made (PATCH /api/admin/job-continuations/[id]
 * with { decision }), so the continuation, pay and notification rules stay
 * entirely on the server. A decline carries the required reason as
 * `decisionNote`, which the server sends to the cleaner.
 */
import { runQueueRequest, type QueueActionResult } from "@/components/v2/admin/command/queue-actions";

export type ContinuationDecision = "APPROVE" | "REJECT";

export function decideContinuation(id: string, decision: ContinuationDecision, reason?: string): Promise<QueueActionResult> {
  return runQueueRequest({
    kind: "request",
    label: decision === "APPROVE" ? "Approve" : "Decline",
    method: "PATCH",
    endpoint: `/api/admin/job-continuations/${encodeURIComponent(id)}`,
    body: decision === "REJECT" ? { decision, decisionNote: reason ?? "" } : { decision },
    doneLabel: decision === "APPROVE" ? "Continuation approved" : "Continuation declined",
  });
}
