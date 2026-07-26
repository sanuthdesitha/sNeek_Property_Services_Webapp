import "server-only";

import { db } from "@/lib/db";
import {
  APPROVAL_DECISION_ACTION,
  type ApprovalDecision,
  type ApprovalDecisionPayload,
  type ApprovalQueueKey,
} from "@/lib/admin/approval-history";

/**
 * ONE writer for every Approval Center decision.
 *
 * Every approve / decline / dismiss / reverse / edit / delete across all fifteen
 * queues lands as an `AuditLog` row with `action = APPROVAL_DECISION` and a
 * consistently-shaped `after` payload, which is what lets a single indexed query
 * (`action` + `createdAt`) serve the whole History tab. Routes that already keep
 * their own richer audit rows keep them — this is additive, not a replacement.
 *
 * Fire-and-forget by contract: a history write must never fail the decision it
 * is recording. A lost history row is a reporting gap; a rolled-back approval
 * because logging hiccuped is a money bug.
 */
export interface RecordApprovalDecisionInput {
  queue: ApprovalQueueKey;
  decision: ApprovalDecision;
  /** Who decided. */
  userId: string;
  /** The row the decision was about. */
  entity: string;
  entityId: string;
  jobId?: string | null;
  label?: string | null;
  amount?: number | null;
  value?: number | null;
  note?: string | null;
  subjectUserId?: string | null;
  subjectName?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  /** Optional snapshot of the row before the decision, for the diff view. */
  before?: unknown;
}

export async function recordApprovalDecision(input: RecordApprovalDecisionInput): Promise<void> {
  const payload: ApprovalDecisionPayload = {
    approvalQueue: input.queue,
    decision: input.decision,
    label: input.label ?? null,
    amount: input.amount ?? null,
    value: input.value ?? null,
    note: input.note ?? null,
    subjectUserId: input.subjectUserId ?? null,
    subjectName: input.subjectName ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
  };

  await db.auditLog
    .create({
      data: {
        userId: input.userId,
        jobId: input.jobId ?? undefined,
        action: APPROVAL_DECISION_ACTION,
        entity: input.entity,
        entityId: input.entityId,
        before: (input.before ?? undefined) as any,
        after: payload as any,
      },
    })
    .catch((err) => {
      // Never surface. See the contract note above.
      console.error("recordApprovalDecision failed", err);
    });
}
