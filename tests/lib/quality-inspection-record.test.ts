/**
 * Quality issues and inspection record (boards "QualitySubpages",
 * "QualityInspection", "M-QualityDetail"): the 48-hour rule shared by the
 * stat card and the Issues tab, the issue words ("No after photo", tints with
 * a reason), findings by area, score lines, the "Who fixes it" timeline, the
 * reasons an AI finding cannot be approved, and inspector scope.
 */
import { describe, expect, it } from "vitest";
import { FIX_OVERDUE_HOURS, fixOwedAge, isFixOverdue } from "@/lib/quality/fix-age";
import { issueTotals, type IssueFact } from "@/lib/quality/groupings";
import {
  falseConfirmationDetailText,
  fixDetailText,
  issueAttention,
  isNoAfterPhoto,
  rectificationLabel,
} from "@/lib/quality/issue-presentation";
import { buildRecordAreas, buildScoreLines, buildWhoFixes, type IssueForArea } from "@/lib/quality/inspection-record-build";
import { findingBand, findingBlockReason } from "@/lib/quality/ai-finding-eligibility";
import { mayReadInspection } from "@/lib/quality/inspection-record";

const NOW = new Date("2026-11-15T10:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe("the 48-hour fix rule", () => {
  it("is overdue only after more than 48 hours, and only while a fix is owed", () => {
    expect(FIX_OVERDUE_HOURS).toBe(48);
    expect(fixOwedAge("PENDING", hoursAgo(48), NOW)).toEqual({ hours: 48, overdue: false });
    expect(fixOwedAge("PENDING", hoursAgo(52), NOW)).toEqual({ hours: 52, overdue: true });
    expect(fixOwedAge("RETURNED_TO_CLEANER", hoursAgo(120), NOW)?.overdue).toBe(true);
    expect(fixOwedAge("FIXED_BY_QA", hoursAgo(120), NOW)).toBeNull();
  });

  it("treats an unreadable raised time as unknown, never as 0 hours", () => {
    expect(fixOwedAge("PENDING", null, NOW)).toBeNull();
    expect(fixOwedAge("PENDING", "not a date", NOW)).toBeNull();
  });

  it("is the same rule the 'Fixes still open … over 48 h' card counts", () => {
    const base: Omit<IssueFact, "id" | "rectificationStatus" | "createdAt"> = {
      cleanerId: "c", cleanerName: "C", raisedById: "q", raisedByName: "Q", raisedByRole: "QA_INSPECTOR", category: "k", severity: "MINOR",
      falseConfirmation: "NONE", rectifiedById: null, rectificationMinutes: null, rectificationCost: null,
    };
    const facts: IssueFact[] = [
      { ...base, id: "a", rectificationStatus: "PENDING", createdAt: hoursAgo(49) },
      { ...base, id: "b", rectificationStatus: "PENDING", createdAt: hoursAgo(47) },
      { ...base, id: "c", rectificationStatus: "FIXED_BY_QA", createdAt: hoursAgo(200) },
      { ...base, id: "d", rectificationStatus: "ESCALATED", createdAt: hoursAgo(300) },
    ];
    const expected = facts.filter((fact) => isFixOverdue(fact.rectificationStatus, fact.createdAt, NOW)).length;
    expect(issueTotals(facts, NOW).openOver48h).toBe(expected);
    expect(expected).toBe(2);
  });
});

describe("issue words on the Issues tab", () => {
  const issue = {
    severity: "MINOR", rectificationStatus: "PENDING", rectificationMinutes: null, rectificationCost: null, rectificationAfterKeys: null, falseConfirmation: "NONE",
  };

  it("tints an overdue fix honey and a critical issue wine, with the reason in words", () => {
    expect(issueAttention({ ...issue, fixOwed: { hours: 52, overdue: true } })).toEqual({ tone: "attention", reason: "Fix owed for over 48 hours" });
    expect(issueAttention({ ...issue, severity: "CRITICAL", fixOwed: { hours: 52, overdue: true } })).toEqual({ tone: "problem", reason: "Critical issue" });
    expect(issueAttention({ ...issue, fixOwed: { hours: 3, overdue: false } })).toBeNull();
  });

  it("writes the fix age, then minutes and cost, and says No after photo for a fix without one", () => {
    expect(fixDetailText({ ...issue, fixOwed: { hours: 52, overdue: true } })).toBe("52 h, over 48 h");
    expect(fixDetailText({ ...issue, fixOwed: { hours: 125, overdue: true } })).toBe("5 d, over 48 h");
    expect(fixDetailText({ ...issue, rectificationStatus: "FIXED_BY_QA", rectificationMinutes: 15, rectificationCost: 11.25, rectificationAfterKeys: ["after.jpg"] })).toBe("15 min · $11.25");
    expect(fixDetailText({ ...issue, rectificationStatus: "FIXED_BY_MANAGER" })).toBe("No after photo");
    expect(isNoAfterPhoto({ rectificationStatus: "FIXED_BY_OTHER_CLEANER", rectificationAfterKeys: [] })).toBe(true);
    expect(isNoAfterPhoto({ rectificationStatus: "RETURNED_TO_CLEANER", rectificationAfterKeys: [] })).toBe(false);
  });

  it("keeps unknown statuses as their own text and an unknown deduction unstated", () => {
    expect(rectificationLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(falseConfirmationDetailText("CONFIRMED", null)).toBeNull();
    expect(falseConfirmationDetailText("CONFIRMED", 10)).toBe("−10 points");
    expect(falseConfirmationDetailText("SUSPECTED", 10)).toBe("decide in the issue");
  });
});

function recordIssue(id: string, fieldId: string | null, extra: Partial<IssueForArea> = {}): IssueForArea {
  return {
    id, fieldId, categoryLabel: "Kitchen detail", description: "d", verdictLabel: "Minor", verdictKey: "MINOR", severity: "MINOR",
    falseConfirmation: "NONE", rectificationStatus: "PENDING", cleanerMarkedComplete: false, guestReadyImpact: false, qaPhotos: [], ...extra,
  };
}

describe("findings by area", () => {
  const schema = {
    sections: [
      { id: "kitchen", title: "Kitchen", fields: [{ id: "oven", label: "Oven" }, { id: "benches", label: "Benches" }, { id: "sig", label: "Sign", type: "signature" }] },
      { id: "signoff", title: "Sign-off", fields: [{ id: "sig2", type: "signature" }] },
    ],
  };

  it("places issues on their item, says nothing about the rest, and keeps issues outside the template", () => {
    const areas = buildRecordAreas(schema, [recordIssue("i1", "oven"), recordIssue("i2", "gone"), recordIssue("i3", null)]);
    expect(areas.map((area) => area.title)).toEqual(["Kitchen", "Other findings"]);
    expect(areas[0].items).toEqual([
      expect.objectContaining({ fieldId: "oven", issue: expect.objectContaining({ id: "i1" }) }),
      { fieldId: "benches", label: "Benches", issue: null },
    ]);
    expect(areas[0].issueCount).toBe(1);
    expect(areas[1].items.map((item) => item.issue?.id)).toEqual(["i2", "i3"]);
  });

  it("counts stored issues by verdict, with standing false confirmations, and never points it cannot know", () => {
    const lines = buildScoreLines(
      [
        { severity: "MINOR", falseConfirmation: "SUSPECTED" },
        { severity: "MINOR", falseConfirmation: "REJECTED" },
        { severity: "MAJOR", failVerdict: true, falseConfirmation: "NONE" },
      ],
      "FAIL",
    );
    expect(lines).toEqual([
      { label: "Minor", count: 2 },
      { label: "Fail", count: 1 },
      { label: "Fail · serious", count: 0 },
      { label: "False confirmations", count: 1 },
    ]);
  });
});

describe("who fixes it", () => {
  const base = { originalCleanerName: "Marco Rossi", reworkJobs: [], transfers: [], deduction: null, issues: [], timeZone: "Australia/Sydney" };

  it("reads the offer, the reassigned rework and the pending deduction in order", () => {
    const result = buildWhoFixes({
      ...base,
      offer: { status: "EXPIRED", offeredAt: new Date("2026-11-11T03:58:00Z"), expiresAt: new Date("2026-11-11T07:00:00Z") },
      reworkJobs: [{ id: "r", jobNumber: "J-1031-R", status: "COMPLETED", createdAt: new Date("2026-11-11T07:01:00Z"), completedAt: new Date("2026-11-11T22:40:00Z"), payAmount: 35, deductFromName: "Marco Rossi", assigneeNames: ["Sam Okafor"] }],
      deduction: { status: "PENDING", amount: -35 },
      issues: [{ rectificationStatus: "FIXED_BY_OTHER_CLEANER" }],
    });
    expect(result.events.map((event) => event.text)).toEqual([
      "Offered back to Marco Rossi, expires Wed 11 Nov 18:00. No pay, no deduction.",
      "Not accepted in time; it came back to the office.",
      "Rework J-1031-R for Sam Okafor. $35.00, same amount proposed as a deduction from Marco Rossi.",
      "Sam Okafor finished the rework.",
    ]);
    expect(result.status).toEqual({ label: "Fixed", tone: "ok" });
    expect(result.note).toContain("waits in Approvals › Pay adjustments: Pending");
  });

  it("is in progress while an offer or transfer is open, and says when nothing was requested", () => {
    expect(buildWhoFixes({ ...base, offer: { status: "OFFERED", offeredAt: new Date(), expiresAt: null } }).status?.label).toBe("In progress");
    const empty = buildWhoFixes({ ...base, offer: { status: null, offeredAt: null, expiresAt: null } });
    expect(empty.status).toBeNull();
    expect(empty.note).toBe("No rework was requested.");
  });
});

describe("AI findings that cannot be approved say why", () => {
  const finding = { id: "f1", fieldId: "oven", mediaId: "m1", confidence: 0.9, confidenceBand: "high" as const };
  const context = { minConfidence: 0.8, coveredFieldIds: [], coveredMediaIds: [], analysisId: "a1", deductedAnalysisIds: [] };

  it("allows an eligible finding (selection only; nothing is applied)", () => {
    expect(findingBlockReason(finding, context)).toBeNull();
  });

  it("refuses below the threshold, over an existing QA issue, and after an earlier photo deduction", () => {
    expect(findingBlockReason({ ...finding, confidence: 0.4, confidenceBand: "low" }, context)).toBe("below the deduction threshold, cannot be approved");
    expect(findingBlockReason(finding, { ...context, coveredFieldIds: ["oven"] })).toMatch(/already has a QA finding/);
    expect(findingBlockReason(finding, { ...context, coveredMediaIds: ["m1"] })).toMatch(/already has a QA finding/);
    expect(findingBlockReason(finding, { ...context, deductedAnalysisIds: ["older"] })).toMatch(/already includes an approved photo deduction/);
    expect(findingBlockReason(finding, { ...context, deductedAnalysisIds: ["a1"] })).toBeNull();
  });

  it("states a band, never the confidence number", () => {
    expect(findingBand({ confidence: 0.95 })).toBe("high");
    expect(findingBand({ confidence: 0.75 })).toBe("medium");
    expect(findingBand({ confidence: 0.2 })).toBe("low");
  });
});

describe("inspection record scope", () => {
  const assignment = { assignedToId: "dana", pickedUpById: null };
  it("lets admins and operations managers read any inspection and inspectors only their own", () => {
    expect(mayReadInspection({ id: "x", role: "ADMIN" }, assignment)).toBe(true);
    expect(mayReadInspection({ id: "x", role: "OPS_MANAGER" }, assignment)).toBe(true);
    expect(mayReadInspection({ id: "dana", role: "QA_INSPECTOR" }, assignment)).toBe(true);
    expect(mayReadInspection({ id: "mei", role: "QA_INSPECTOR" }, assignment)).toBe(false);
    expect(mayReadInspection({ id: "mei", role: "QA_INSPECTOR" }, { assignedToId: null, pickedUpById: "mei" })).toBe(true);
    expect(mayReadInspection({ id: "c", role: "CLEANER" }, assignment)).toBe(false);
  });
});
