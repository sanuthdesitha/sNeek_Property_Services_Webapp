/**
 * Approval Center HISTORY — what was decided, by whom, when, and what may still
 * be done about it. Pure module: no DB, no I/O (the recorder that writes to the
 * database lives in approval-history-write.ts).
 *
 * WHY AuditLog AND NOT A NEW TABLE
 * --------------------------------
 * `AuditLog` already carries every field a decision history needs and is already
 * queryable on all of them:
 *   userId    → WHO decided                (indexed: [userId, createdAt])
 *   createdAt → WHEN                       (indexed)
 *   entity    → WHAT KIND of thing         (indexed: [entity, entityId])
 *   entityId  → WHICH row                  (same index)
 *   action    → the decision verb
 *   jobId     → link back to the job       (indexed)
 *   before/after (Json) → the amount/value at decision time + the note
 * A parallel table would duplicate all of that, fall out of sync with the audit
 * writes several routes already make (the pay-adjustment PATCH has written
 * REVIEW_PAY_ADJUSTMENT rows for a long time), and give two contradictory
 * answers to "what happened to this request". The only thing AuditLog lacked was
 * a CONSISTENT SHAPE across queues — which is what this module supplies: one
 * action vocabulary and one payload contract, so a single indexed query can
 * serve the whole Approval Center, and the one available migration goes to the
 * QA-pay columns, which genuinely cannot be expressed without schema.
 *
 * CAPABILITIES
 * ------------
 * Not every queue supports every verb, and the UI must not offer a button the
 * server will refuse. `approvalCapabilities` is the single source of truth for
 * both sides: the client renders from it, and the routes enforce the same rules.
 */

/** Every queue in the Approval Center. Mirrors QUEUES in approvals-workspace.tsx. */
export const APPROVAL_QUEUE_KEYS = [
  "continuations",
  "timingRequests",
  "payAdjustments",
  "timeAdjustments",
  "clientApprovals",
  "flaggedLaundry",
  "rescheduleRequests",
  "clientRequests",
  "qaReworkTransfers",
  "qaOutcomes",
  "skipRequests",
  "rectificationAdjustments",
  "bonusProposals",
  "falseConfirmations",
  "managementReviews",
] as const;

export type ApprovalQueueKey = (typeof APPROVAL_QUEUE_KEYS)[number];

/** The decision that was taken. Deliberately small — the UI groups on it. */
export type ApprovalDecision = "APPROVED" | "DECLINED" | "DISMISSED" | "REVERSED" | "EDITED" | "DELETED";

/** The single audit action every Approval Center decision is written under. */
export const APPROVAL_DECISION_ACTION = "APPROVAL_DECISION";

/**
 * The payload shape stored in `AuditLog.after` for an APPROVAL_DECISION row.
 * Everything the history list renders comes from here, so a queue's own row can
 * be deleted later and the history still reads correctly.
 */
export interface ApprovalDecisionPayload {
  approvalQueue: ApprovalQueueKey;
  decision: ApprovalDecision;
  /** Human label for the item ("Extra pay — 12 Rose St"). */
  label?: string | null;
  /** The money/value at decision time. Signed; null when the queue has no amount. */
  amount?: number | null;
  /** Non-money value at decision time (e.g. approved minutes on a clock fix). */
  value?: number | null;
  /** Free-text note the decider left. */
  note?: string | null;
  /** The affected worker/client, for "who was this about". */
  subjectUserId?: string | null;
  subjectName?: string | null;
  /** Previous status, so a reversal reads as a transition. */
  fromStatus?: string | null;
  toStatus?: string | null;
}

/** What a decided item may still have done to it. */
export interface ApprovalCapabilities {
  canEdit: boolean;
  canUndo: boolean;
  canDelete: boolean;
  /** Per-verb reason it is unavailable. Absent = the verb is available. */
  reasons: Partial<Record<"edit" | "undo" | "delete", string>>;
}

/**
 * Static, per-queue support. This is about what the DOMAIN allows at all — the
 * per-item guards (settled money, wrong status) are applied on top by
 * `approvalCapabilities`.
 */
interface QueueCapabilitySpec {
  /** The entity name written to AuditLog.entity for this queue. */
  entity: string;
  canEdit: boolean;
  canUndo: boolean;
  canDelete: boolean;
  /** Why a statically-unsupported verb is unsupported. */
  reasons: Partial<Record<"edit" | "undo" | "delete", string>>;
}

/**
 * WHY SO MANY VERBS ARE OFF
 * -------------------------
 * The rule for this map is: a verb is TRUE only when a server route actually
 * implements it end-to-end. Offering an "Undo" the server will refuse — or,
 * worse, one that flips a status without unwinding the side effects the original
 * decision caused — is how a books-vs-reality drift starts. Where the domain
 * makes reversal genuinely unsafe, the reason names the correct alternative.
 */
const NO_EDIT = "This queue has no amount to re-price.";
const NO_DELETE_DERIVED =
  "This is derived from job data rather than a request row, so there is nothing to delete.";
const REVIEW_ONLY = "This queue is review-and-route only — it records no approve/decline decision.";

export const APPROVAL_QUEUE_CAPABILITIES: Record<ApprovalQueueKey, QueueCapabilitySpec> = {
  // Review-and-route queues: the card links to the job, no decision is taken here.
  continuations: {
    entity: "JobContinuationRequest",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: { edit: REVIEW_ONLY, undo: REVIEW_ONLY, delete: REVIEW_ONLY },
  },
  flaggedLaundry: {
    entity: "LaundryTask",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: { edit: REVIEW_ONLY, undo: REVIEW_ONLY, delete: REVIEW_ONLY },
  },

  // ── Money queues ──────────────────────────────────────────────────────
  // All three are CleanerPayAdjustment-backed and share one route that already
  // implements re-pricing (PATCH approvedAmount), reversal to PENDING, and
  // deletion of an erroneous request — with the settled-money 409 on top.
  payAdjustments: {
    entity: "CleanerPayAdjustment",
    canEdit: true,
    canUndo: true,
    canDelete: true,
    reasons: {},
  },
  rectificationAdjustments: {
    entity: "CleanerPayAdjustment",
    canEdit: true,
    canUndo: true,
    canDelete: true,
    reasons: {},
  },
  bonusProposals: {
    entity: "CleanerPayAdjustment",
    canEdit: true,
    canUndo: true,
    canDelete: true,
    reasons: {},
  },

  // Client approvals: the PATCH route supports amount edits and a return to
  // PENDING, and DELETE removes the record from the client portal too.
  clientApprovals: {
    entity: "ClientApproval",
    canEdit: true,
    canUndo: true,
    canDelete: true,
    reasons: {},
  },

  // A skip is a reversible state on the Job: action=unskip restores the clean.
  skipRequests: {
    entity: "Job",
    canEdit: false,
    canUndo: true,
    canDelete: false,
    reasons: { edit: NO_EDIT, delete: NO_DELETE_DERIVED },
  },

  // ── Queues whose decisions have already rewritten something else ──────
  timeAdjustments: {
    entity: "TimeLogAdjustmentRequest",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: "An approved clock fix has already been written into the timesheet — file a new adjustment rather than re-editing this one.",
      undo: "Reversing an applied clock fix would leave the timesheet and the request disagreeing. File a correcting adjustment instead.",
      delete: "A cleaner's clock-fix request is kept for the audit trail; decline it instead.",
    },
  },
  timingRequests: {
    entity: "JobEarlyCheckoutRequest",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: NO_EDIT,
      undo: "Approving a timing change rewrote the job's start/due time — change the times on the job itself.",
      delete: "The client's timing request is kept for the audit trail.",
    },
  },
  rescheduleRequests: {
    entity: "JobTask",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: NO_EDIT,
      undo: "An approved reschedule has already moved the job — reschedule it again from the job instead.",
      delete: "The client's request is kept for the audit trail.",
    },
  },
  clientRequests: {
    entity: "JobTask",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: NO_EDIT,
      undo: "The reply/report this decision released has already gone to the client.",
      delete: "The client's request is kept for the audit trail.",
    },
  },
  qaReworkTransfers: {
    entity: "QaReworkTransfer",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: "Re-price the resulting pay adjustment rather than the transfer.",
      undo: "An approved transfer has already written pay adjustments against both people — reverse those instead.",
      delete: NO_DELETE_DERIVED,
    },
  },
  qaOutcomes: {
    entity: "Job",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: NO_EDIT,
      undo: "Approving the outcome moved the job to COMPLETED and unlocked invoicing — reopen the job instead.",
      delete: NO_DELETE_DERIVED,
    },
  },
  falseConfirmations: {
    entity: "QaIssue",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: NO_EDIT,
      undo: "The decision already adjusted the QA score — re-score the review instead.",
      delete: NO_DELETE_DERIVED,
    },
  },
  managementReviews: {
    entity: "QAReview",
    canEdit: false,
    canUndo: false,
    canDelete: false,
    reasons: {
      edit: "Re-score the review on the job's QA tab — that is how a review is corrected.",
      undo: "Re-score the review instead; editing a review is its own correction.",
      delete: NO_DELETE_DERIVED,
    },
  },
};

/**
 * Per-item state that can further restrict what the static queue spec allows.
 * Everything is optional: an unknown field simply doesn't restrict.
 */
export interface ApprovalItemState {
  /** Payroll run id that has already paid this money. */
  includedInPayrollRunId?: string | null;
  /** Cleaner invoice id that has already billed this money. */
  includedInCleanerInvoiceId?: string | null;
  /** Current status of the underlying row. */
  status?: string | null;
  /** True when the underlying row no longer exists (deleted, or job re-flowed). */
  missing?: boolean;
}

/** The message the sibling agent's immutability rule speaks with. Kept verbatim
 *  so the UI and the 409 responses read identically. */
export const SETTLED_IMMUTABLE_REASON =
  "This has already been settled (paid by a payroll run or billed on a cleaner invoice) and can no longer be re-decided. Raise a correcting adjustment instead.";

/**
 * What may still be done to a decided item.
 *
 * Order of restriction (most important first):
 *   1. The row is gone            → nothing.
 *   2. The money is SETTLED       → nothing that changes money. This is the
 *      sibling agent's rule and it overrides the queue spec entirely: a payroll
 *      run or cleaner invoice has already moved real dollars, so un-deciding it
 *      would desynchronise the books from what was actually paid.
 *   3. An APPROVED row            → cannot be deleted (it may already feed
 *      payroll); reverse it to pending first. Mirrors the DELETE route's 409.
 *   4. Otherwise                  → whatever the queue statically supports.
 */
export function approvalCapabilities(
  queue: ApprovalQueueKey,
  state: ApprovalItemState = {}
): ApprovalCapabilities {
  const spec = APPROVAL_QUEUE_CAPABILITIES[queue];
  if (!spec) {
    const reason = "Unknown approval queue.";
    return { canEdit: false, canUndo: false, canDelete: false, reasons: { edit: reason, undo: reason, delete: reason } };
  }

  const reasons: ApprovalCapabilities["reasons"] = { ...spec.reasons };

  if (state.missing) {
    const reason = "The underlying record no longer exists.";
    return {
      canEdit: false,
      canUndo: false,
      canDelete: false,
      reasons: { edit: reason, undo: reason, delete: reason },
    };
  }

  const settledBy = state.includedInPayrollRunId ?? state.includedInCleanerInvoiceId ?? null;
  if (settledBy) {
    return {
      canEdit: false,
      canUndo: false,
      canDelete: false,
      reasons: {
        edit: SETTLED_IMMUTABLE_REASON,
        undo: SETTLED_IMMUTABLE_REASON,
        delete: SETTLED_IMMUTABLE_REASON,
      },
    };
  }

  let canDelete = spec.canDelete;
  if (canDelete && state.status === "APPROVED") {
    canDelete = false;
    reasons.delete =
      "An approved request cannot be deleted — it may already feed payroll. Reverse it back to pending first.";
  }

  // Nothing to undo on a row that is already back in the pending pool.
  let canUndo = spec.canUndo;
  if (canUndo && state.status === "PENDING") {
    canUndo = false;
    reasons.undo = "This is already pending — there is no decision to reverse.";
  }

  return {
    canEdit: spec.canEdit,
    canUndo,
    canDelete,
    reasons,
  };
}

/** Type guard for a queue key arriving from a query string / request body. */
export function isApprovalQueueKey(value: unknown): value is ApprovalQueueKey {
  return typeof value === "string" && (APPROVAL_QUEUE_KEYS as readonly string[]).includes(value);
}

/**
 * Read an APPROVAL_DECISION payload back out of an AuditLog row's `after` blob,
 * tolerating legacy/partial rows. Returns null when the blob is not a decision
 * payload at all, so the history list can skip it rather than render blanks.
 */
export function parseApprovalDecisionPayload(after: unknown): ApprovalDecisionPayload | null {
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const row = after as Record<string, unknown>;
  if (!isApprovalQueueKey(row.approvalQueue)) return null;
  const decision = row.decision;
  const validDecision =
    decision === "APPROVED" ||
    decision === "DECLINED" ||
    decision === "DISMISSED" ||
    decision === "REVERSED" ||
    decision === "EDITED" ||
    decision === "DELETED";
  if (!validDecision) return null;

  const num = (value: unknown): number | null => {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  return {
    approvalQueue: row.approvalQueue,
    decision,
    label: str(row.label),
    amount: num(row.amount),
    value: num(row.value),
    note: str(row.note),
    subjectUserId: str(row.subjectUserId),
    subjectName: str(row.subjectName),
    fromStatus: str(row.fromStatus),
    toStatus: str(row.toStatus),
  };
}

/**
 * Where an entity id lives in the app, so the history row can link back.
 * Returns null when there is nothing meaningful to link to.
 */
export function approvalEntityHref(
  queue: ApprovalQueueKey,
  entityId: string,
  jobId?: string | null
): string | null {
  if (jobId) return `/v2/admin/jobs/${jobId}`;
  switch (queue) {
    case "skipRequests":
    case "qaOutcomes":
      return `/v2/admin/jobs/${entityId}`;
    default:
      return null;
  }
}
