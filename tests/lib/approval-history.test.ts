import { describe, it, expect } from "vitest";
import {
  APPROVAL_DECISION_ACTION,
  APPROVAL_QUEUE_CAPABILITIES,
  APPROVAL_QUEUE_KEYS,
  SETTLED_IMMUTABLE_REASON,
  approvalCapabilities,
  approvalEntityHref,
  isApprovalQueueKey,
  parseApprovalDecisionPayload,
  type ApprovalQueueKey,
} from "@/lib/admin/approval-history";

const MONEY_QUEUES: ApprovalQueueKey[] = [
  "payAdjustments",
  "rectificationAdjustments",
  "bonusProposals",
];

describe("the capability map covers every queue exactly once", () => {
  it("has a spec for all 15 queues and no extras", () => {
    expect(APPROVAL_QUEUE_KEYS).toHaveLength(15);
    expect(Object.keys(APPROVAL_QUEUE_CAPABILITIES).sort()).toEqual([...APPROVAL_QUEUE_KEYS].sort());
  });

  it("gives a reason for every verb it refuses", () => {
    // A disabled button with no explanation is worse than no button — the UI
    // renders `reasons[verb]` as the tooltip, so an unsupported verb must have one.
    for (const key of APPROVAL_QUEUE_KEYS) {
      const spec = APPROVAL_QUEUE_CAPABILITIES[key];
      if (!spec.canEdit) expect(spec.reasons.edit, `${key}.edit`).toBeTruthy();
      if (!spec.canUndo) expect(spec.reasons.undo, `${key}.undo`).toBeTruthy();
      if (!spec.canDelete) expect(spec.reasons.delete, `${key}.delete`).toBeTruthy();
    }
  });

  it("never supplies a reason for a verb it allows (the reason would render as a refusal)", () => {
    for (const key of APPROVAL_QUEUE_KEYS) {
      const spec = APPROVAL_QUEUE_CAPABILITIES[key];
      if (spec.canEdit) expect(spec.reasons.edit, `${key}.edit`).toBeUndefined();
      if (spec.canUndo) expect(spec.reasons.undo, `${key}.undo`).toBeUndefined();
      if (spec.canDelete) expect(spec.reasons.delete, `${key}.delete`).toBeUndefined();
    }
  });
});

describe("approvalCapabilities — the money queues", () => {
  for (const queue of MONEY_QUEUES) {
    it(`${queue}: an unsettled PENDING row can be edited and deleted but not undone`, () => {
      const caps = approvalCapabilities(queue, { status: "PENDING" });
      expect(caps.canEdit).toBe(true);
      expect(caps.canDelete).toBe(true);
      // Nothing to reverse — it is already back in the pending pool.
      expect(caps.canUndo).toBe(false);
      expect(caps.reasons.undo).toMatch(/already pending/i);
    });

    it(`${queue}: an APPROVED but unsettled row can be edited and undone, NOT deleted`, () => {
      const caps = approvalCapabilities(queue, { status: "APPROVED" });
      expect(caps.canEdit).toBe(true);
      expect(caps.canUndo).toBe(true);
      expect(caps.canDelete).toBe(false);
      expect(caps.reasons.delete).toMatch(/reverse it back to pending/i);
    });

    it(`${queue}: a PAYROLL-settled row refuses everything with the correcting-adjustment message`, () => {
      const caps = approvalCapabilities(queue, {
        status: "APPROVED",
        includedInPayrollRunId: "run-1",
      });
      expect(caps).toEqual({
        canEdit: false,
        canUndo: false,
        canDelete: false,
        reasons: {
          edit: SETTLED_IMMUTABLE_REASON,
          undo: SETTLED_IMMUTABLE_REASON,
          delete: SETTLED_IMMUTABLE_REASON,
        },
      });
      expect(SETTLED_IMMUTABLE_REASON).toMatch(/correcting adjustment/i);
    });

    it(`${queue}: an INVOICE-settled row is equally immutable`, () => {
      const caps = approvalCapabilities(queue, {
        status: "APPROVED",
        includedInCleanerInvoiceId: "inv-1",
      });
      expect(caps.canEdit).toBe(false);
      expect(caps.canUndo).toBe(false);
      expect(caps.canDelete).toBe(false);
    });

    it(`${queue}: settlement beats a REJECTED status too`, () => {
      // Settlement is the strongest signal there is — real dollars moved.
      const caps = approvalCapabilities(queue, {
        status: "REJECTED",
        includedInPayrollRunId: "run-9",
      });
      expect(caps.canEdit).toBe(false);
    });
  }
});

describe("approvalCapabilities — a vanished row supports nothing", () => {
  it("refuses every verb when the underlying record is gone", () => {
    const caps = approvalCapabilities("payAdjustments", { missing: true });
    expect(caps.canEdit).toBe(false);
    expect(caps.canUndo).toBe(false);
    expect(caps.canDelete).toBe(false);
    expect(caps.reasons.edit).toMatch(/no longer exists/i);
  });

  it("checks 'missing' BEFORE the queue's static support", () => {
    const caps = approvalCapabilities("clientApprovals", { missing: true });
    expect(caps.canDelete).toBe(false);
  });
});

describe("approvalCapabilities — queues whose decisions already rewrote something else", () => {
  const terminal: ApprovalQueueKey[] = [
    "timeAdjustments",
    "timingRequests",
    "rescheduleRequests",
    "clientRequests",
    "qaReworkTransfers",
    "qaOutcomes",
    "falseConfirmations",
    "managementReviews",
    "continuations",
    "flaggedLaundry",
  ];

  for (const queue of terminal) {
    it(`${queue} offers no verbs, and says why`, () => {
      const caps = approvalCapabilities(queue, { status: "APPROVED" });
      expect(caps.canEdit).toBe(false);
      expect(caps.canUndo).toBe(false);
      expect(caps.canDelete).toBe(false);
      expect(caps.reasons.undo).toBeTruthy();
    });
  }

  it("qaOutcomes explains that the job already moved to COMPLETED", () => {
    expect(approvalCapabilities("qaOutcomes").reasons.undo).toMatch(/COMPLETED|reopen/i);
  });
});

describe("approvalCapabilities — skip requests", () => {
  it("an approved skip can be undone (the clean is restored)", () => {
    const caps = approvalCapabilities("skipRequests", { status: "SKIPPED" });
    expect(caps.canUndo).toBe(true);
    expect(caps.canEdit).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it("an unknown queue key refuses everything rather than defaulting open", () => {
    const caps = approvalCapabilities("nope" as ApprovalQueueKey);
    expect(caps.canEdit).toBe(false);
    expect(caps.canUndo).toBe(false);
    expect(caps.canDelete).toBe(false);
  });
});

describe("isApprovalQueueKey", () => {
  it("accepts real keys and rejects everything else", () => {
    expect(isApprovalQueueKey("payAdjustments")).toBe(true);
    expect(isApprovalQueueKey("nope")).toBe(false);
    expect(isApprovalQueueKey(null)).toBe(false);
    expect(isApprovalQueueKey(7)).toBe(false);
  });
});

describe("parseApprovalDecisionPayload", () => {
  const good = {
    approvalQueue: "payAdjustments",
    decision: "APPROVED",
    label: " Extra pay — 12 Rose St ",
    amount: -45.5,
    note: "  agreed with cleaner  ",
    subjectUserId: "u1",
    subjectName: "Sam",
    fromStatus: "PENDING",
    toStatus: "APPROVED",
  };

  it("reads a well-formed payload and trims strings", () => {
    const parsed = parseApprovalDecisionPayload(good);
    expect(parsed).toEqual({
      approvalQueue: "payAdjustments",
      decision: "APPROVED",
      label: "Extra pay — 12 Rose St",
      // A deduction must survive as a NEGATIVE number, exactly as in payroll.
      amount: -45.5,
      value: null,
      note: "agreed with cleaner",
      subjectUserId: "u1",
      subjectName: "Sam",
      fromStatus: "PENDING",
      toStatus: "APPROVED",
    });
  });

  it("rejects non-decision audit blobs so the history can skip them", () => {
    expect(parseApprovalDecisionPayload(null)).toBeNull();
    expect(parseApprovalDecisionPayload("nope")).toBeNull();
    expect(parseApprovalDecisionPayload([])).toBeNull();
    expect(parseApprovalDecisionPayload({ score: 90 })).toBeNull();
    expect(parseApprovalDecisionPayload({ approvalQueue: "bogus", decision: "APPROVED" })).toBeNull();
    expect(
      parseApprovalDecisionPayload({ approvalQueue: "payAdjustments", decision: "MAYBE" })
    ).toBeNull();
  });

  it("nulls out non-finite / empty values rather than propagating NaN", () => {
    const parsed = parseApprovalDecisionPayload({
      approvalQueue: "timeAdjustments",
      decision: "DECLINED",
      amount: "abc",
      value: 90,
      note: "   ",
    });
    expect(parsed?.amount).toBeNull();
    expect(parsed?.value).toBe(90);
    expect(parsed?.note).toBeNull();
  });

  it("accepts every decision verb the writer can emit", () => {
    for (const decision of ["APPROVED", "DECLINED", "DISMISSED", "REVERSED", "EDITED", "DELETED"]) {
      expect(
        parseApprovalDecisionPayload({ approvalQueue: "payAdjustments", decision })?.decision
      ).toBe(decision);
    }
  });
});

describe("approvalEntityHref", () => {
  it("prefers the linked job", () => {
    expect(approvalEntityHref("payAdjustments", "adj1", "job1")).toBe("/v2/admin/jobs/job1");
  });

  it("uses the entity id for job-backed queues with no jobId column", () => {
    expect(approvalEntityHref("skipRequests", "job9", null)).toBe("/v2/admin/jobs/job9");
    expect(approvalEntityHref("qaOutcomes", "job9", null)).toBe("/v2/admin/jobs/job9");
  });

  it("returns null when there is nothing meaningful to open", () => {
    expect(approvalEntityHref("payAdjustments", "adj1", null)).toBeNull();
  });
});

describe("the audit action is a single stable constant", () => {
  it("is APPROVAL_DECISION — the whole history query depends on it", () => {
    expect(APPROVAL_DECISION_ACTION).toBe("APPROVAL_DECISION");
  });
});
