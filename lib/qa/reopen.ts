/**
 * Reopening a submitted QA inspection (amend-in-place).
 *
 * A completed QA inspection is a scoring- and pay-relevant record: it feeds the
 * cleaner's accountability score, their streak/bonus eligibility and — when the
 * inspector raised a rework — real money. So "let me fix that verdict" can never
 * be a silent edit. This module is the PURE decision layer for that flow:
 *
 *   canReopenInspection() — who may reopen what, and why not.
 *   reopenMoneyWarnings() — the plain-English warnings the UI must show BEFORE
 *                           reopening, listing what reopening does NOT undo.
 *
 * Deliberate policy (enforced by the caller,
 * `app/api/qa/jobs/[id]/reopen/route.ts`):
 *   • Reopening flips the QaAssignment back to IN_PROGRESS. Nothing else is
 *     mutated — no rework job is cancelled, no CleanerPayAdjustment is deleted
 *     or rewritten. Money already in flight is handled in the Approval Center.
 *     (The destructive "wipe it and start over" path already exists and stays
 *     admin-only: `app/api/admin/jobs/[id]/qa-reset/route.ts`.)
 *   • Re-submitting UPDATES the existing QAReview via its edit fields
 *     (editedById / editedAt / adjustmentReason) instead of stacking a second
 *     review on the job, so the job's authoritative score stays single-valued.
 *   • Every reopen writes an AuditLog row with the actor and their reason.
 *
 * Pure (no db, no I/O) so it is unit-tested in tests/lib/qa-reopen.test.ts.
 */

/** Minimum characters for the mandatory "why are you reopening this" reason. */
export const REOPEN_REASON_MIN_LENGTH = 10;

/** Roles permitted to reopen at all (an inspector additionally must own it). */
export const REOPEN_ROLES = ["ADMIN", "OPS_MANAGER", "QA_INSPECTOR"] as const;

export type ReopenBlockCode =
  | "ROLE_NOT_ALLOWED"
  | "JOB_LOCKED"
  | "NOT_COMPLETED"
  | "NOT_YOUR_INSPECTION"
  | "REASON_TOO_SHORT";

export interface ReopenAssignmentShape {
  status: string;
  assignedToId?: string | null;
  pickedUpById?: string | null;
}

export interface ReopenEligibilityInput {
  actorUserId: string;
  actorRole: string;
  assignment: ReopenAssignmentShape;
  /** Job.status — an INVOICED job is financially closed and stays locked. */
  jobStatus: string;
  /** Omit when only testing visibility (the button); required to actually act. */
  reason?: string | null;
}

export interface ReopenEligibility {
  ok: boolean;
  code?: ReopenBlockCode;
  /** Operator-facing explanation, safe to show in the UI verbatim. */
  message?: string;
}

/**
 * May this person reopen this inspection?
 *
 * Order matters — the first failing rule is the one reported, cheapest and most
 * explanatory first: role, then the job lock, then the assignment state, then
 * ownership, then the reason. Passing `reason: undefined` skips only the reason
 * check, so the UI can use the same predicate to decide whether to OFFER the
 * action before the operator has typed anything.
 */
export function canReopenInspection(input: ReopenEligibilityInput): ReopenEligibility {
  const role = String(input.actorRole || "").toUpperCase();
  if (!(REOPEN_ROLES as readonly string[]).includes(role)) {
    return {
      ok: false,
      code: "ROLE_NOT_ALLOWED",
      message: "Only the inspector who did this review, an admin or an ops manager can reopen it.",
    };
  }

  if (String(input.jobStatus || "").toUpperCase() === "INVOICED") {
    return {
      ok: false,
      code: "JOB_LOCKED",
      message: "This job is invoiced and locked — its QA can't be reopened.",
    };
  }

  if (String(input.assignment?.status || "").toUpperCase() !== "COMPLETED") {
    return {
      ok: false,
      code: "NOT_COMPLETED",
      message: "This inspection isn't submitted yet, so there's nothing to reopen.",
    };
  }

  const isManager = role === "ADMIN" || role === "OPS_MANAGER";
  const owns =
    Boolean(input.actorUserId) &&
    (input.assignment.assignedToId === input.actorUserId ||
      input.assignment.pickedUpById === input.actorUserId);
  if (!isManager && !owns) {
    return {
      ok: false,
      code: "NOT_YOUR_INSPECTION",
      message: "This inspection belongs to another inspector — ask an admin or ops manager to reopen it.",
    };
  }

  if (input.reason !== undefined) {
    const reason = String(input.reason ?? "").trim();
    if (reason.length < REOPEN_REASON_MIN_LENGTH) {
      return {
        ok: false,
        code: "REASON_TOO_SHORT",
        message: `Say why you're reopening this inspection (at least ${REOPEN_REASON_MIN_LENGTH} characters) — it goes on the record.`,
      };
    }
  }

  return { ok: true };
}

/** What this inspection already set in motion, counted by the caller. */
export interface ReopenMoneyFacts {
  /** Rework jobs spawned from this inspection (Job.reworkOfJobId === jobId). */
  reworkJobCount: number;
  /** …of those, how many are already started/submitted/completed. */
  startedReworkJobCount: number;
  /** CleanerPayAdjustment rows booked against this job (any status). */
  payAdjustmentCount: number;
  /** …of those, how many are already approved or stamped into a payroll run. */
  settledPayAdjustmentCount: number;
  /** QA issues from this review that already carry a proposed pay adjustment. */
  issuesWithPayAdjustmentCount: number;
  /** QA issues from this review that have already been rectified/actioned. */
  actionedIssueCount: number;
}

/**
 * The warnings the UI must show before reopening. Every line states a real
 * consequence that reopening does NOT undo, and where to go instead. Returns
 * an empty array when this inspection moved no money and actioned nothing.
 */
export function reopenMoneyWarnings(facts: ReopenMoneyFacts): string[] {
  const out: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (facts.reworkJobCount > 0) {
    out.push(
      `This inspection created ${plural(facts.reworkJobCount, "rework job", "rework jobs")}${
        facts.startedReworkJobCount > 0
          ? ` (${facts.startedReworkJobCount} already started)`
          : ""
      }. Reopening does not cancel it — cancel or reassign it from the job list separately.`
    );
  }
  if (facts.payAdjustmentCount > 0) {
    out.push(
      `${plural(facts.payAdjustmentCount, "pay adjustment", "pay adjustments")} ${
        facts.payAdjustmentCount === 1 ? "is" : "are"
      } booked against this job${
        facts.settledPayAdjustmentCount > 0
          ? `, ${facts.settledPayAdjustmentCount} of them already approved or paid`
          : ""
      }. Reopening does not reverse pay — adjust it in the Approval Center.`
    );
  }
  if (facts.issuesWithPayAdjustmentCount > 0 || facts.actionedIssueCount > 0) {
    const n = facts.issuesWithPayAdjustmentCount + facts.actionedIssueCount;
    out.push(
      `${plural(n, "flagged item", "flagged items")} from this inspection ${
        n === 1 ? "has" : "have"
      } already been actioned (rectification or pay). ${
        n === 1 ? "It" : "They"
      } stay on the record when you re-submit — only untouched findings are replaced.`
    );
  }
  return out;
}

/** True when reopening this inspection has money/rectification consequences. */
export function reopenTouchesMoney(facts: ReopenMoneyFacts): boolean {
  return reopenMoneyWarnings(facts).length > 0;
}
