/**
 * Approve or decline a continuation request: the same call the old inline
 * ContinuationDecisions list made (PATCH /api/admin/job-continuations/[id]
 * with { decision: "APPROVE" | "REJECT" } and nothing else), so the
 * continuation, pay and notification rules stay entirely on the server.
 */
import { runQueueRequest, type QueueActionResult } from "@/components/v2/admin/command/queue-actions";

export type ContinuationDecision = "APPROVE" | "REJECT";

export function decideContinuation(id: string, decision: ContinuationDecision): Promise<QueueActionResult> {
  return runQueueRequest({
    kind: "request",
    label: decision === "APPROVE" ? "Approve" : "Decline",
    method: "PATCH",
    endpoint: `/api/admin/job-continuations/${encodeURIComponent(id)}`,
    body: { decision },
    doneLabel: decision === "APPROVE" ? "Continuation approved" : "Continuation declined",
  });
}
