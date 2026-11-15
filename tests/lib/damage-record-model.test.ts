import { describe, expect, it } from "vitest";
import { DamageReportStatus, DamageSeverity } from "@prisma/client";
import { toInvestigationViewModel } from "@/lib/damage/investigation";
import {
  buildDamageHistory,
  damageRecordStages,
  estimateCoverageText,
  releaseMessageText,
  summariseEstimates,
} from "@/lib/damage/record-model";

/**
 * The damage report record page (board "Damage report", 2026-11-14): a blank
 * estimate is "not estimated" and never counted as $0; the total says how
 * many items it covers; originals and marked-up copies are both kept; the
 * client preview uses the client serializer and carries nothing office-only.
 */

describe("estimate total", () => {
  it("leaves blank estimates out and says how many items it covers", () => {
    const summary = summariseEstimates([{ estimatedCost: 350 }, { estimatedCost: 70 }, { estimatedCost: null }]);
    expect(summary).toEqual({ total: 420, estimatedItems: 2, itemCount: 3 });
    expect(estimateCoverageText(summary)).toBe("2 of 3 items · 1 not estimated");
  });

  it("is unknown, not $0, when nothing is estimated", () => {
    const summary = summariseEstimates([{ estimatedCost: null }, { estimatedCost: null }]);
    expect(summary.total).toBeNull();
    expect(estimateCoverageText(summary)).toBe("0 of 2 items · 2 not estimated");
  });

  it("keeps a real zero estimate as an estimate and sums in whole cents", () => {
    expect(summariseEstimates([{ estimatedCost: 0 }, { estimatedCost: 0.1 }, { estimatedCost: 0.2 }])).toEqual({ total: 0.3, estimatedItems: 3, itemCount: 3 });
  });
});

const photoRow = {
  id: "clx0rep1",
  status: DamageReportStatus.UNDER_REVIEW,
  submittedAt: new Date("2026-11-11T00:40:00.000Z"),
  clientVisible: false,
  reviewedAt: new Date("2026-11-11T01:00:00.000Z"),
  reviewedBy: { name: "Hannah Lee", email: "hannah@example.com" },
  reportedBy: { name: "Maria Santos", email: "maria@example.com" },
  jobId: "job1",
  propertyId: "prop1",
  property: { id: "prop1", name: "Bondi Beach House" },
  voids: [{ id: "v1", mode: "KEEP_AND_REOPEN", reason: "Photos do not show the damage", voidedAt: new Date("2026-11-10T22:12:00.000Z"), voidedBy: { name: "Hannah Lee", email: null } }],
  items: [
    {
      id: "item1",
      area: "Kitchen",
      category: "Benchtop",
      severity: DamageSeverity.MAJOR,
      description: "Burn mark about 8 cm across.",
      suspectedCause: "GUEST",
      estimatedCost: 350,
      photos: [
        { id: "p1", s3Key: "damage/original.jpg", annotatedKey: "damage/overlay.png", flatKey: "damage/flat.jpg", caption: null, section: "CLOSE_UP" },
        { id: "p2", s3Key: "damage/plain.jpg", annotatedKey: null, flatKey: null, caption: null, section: "OVERVIEW" },
      ],
      case: {
        id: "case1",
        state: "OPEN",
        status: "OPEN",
        transitions: [{ id: "t1", fromState: null, toState: "OPEN", reason: "Internal: guest card on file", occurredAt: new Date("2026-11-10T01:48:00.000Z"), actor: { name: "Maria Santos", email: null } }],
        maintenanceItems: [],
      },
    },
  ],
};

describe("photos: originals are kept and labelled apart from the marked-up copy", () => {
  it("gives the office both the untouched original and the marked-up copy", () => {
    const vm = toInvestigationViewModel(photoRow, "ADMIN", (key) => `https://cdn.test/${key}`);
    expect(vm.items[0].photos[0]).toMatchObject({ originalUrl: "https://cdn.test/damage/original.jpg", markedUpUrl: "https://cdn.test/damage/flat.jpg", url: "https://cdn.test/damage/flat.jpg", annotated: true });
    expect(vm.items[0].photos[1]).toMatchObject({ originalUrl: "https://cdn.test/damage/plain.jpg", markedUpUrl: null });
  });
});

describe("Preview as the client uses the client serializer", () => {
  it("carries no estimate, internal note, reviewer, send-back history or original/markup split", () => {
    const vm = toInvestigationViewModel(photoRow, "CLIENT", (key) => `https://cdn.test/${key}`);
    const json = JSON.stringify(vm);
    expect(vm.items[0].estimatedCost).toBeNull();
    expect(vm.reviewedByName).toBeNull();
    expect(vm.voids).toEqual([]);
    expect(vm.items[0].transitions[0].reason).toBeNull();
    expect(vm.items[0].photos[0]).toMatchObject({ originalUrl: null, markedUpUrl: null });
    for (const secret of ["350", "guest card on file", "Hannah", "Photos do not show the damage", "original.jpg"]) expect(json).not.toContain(secret);
  });
});

describe("history", () => {
  const base = {
    voids: [{ id: "v1", mode: "KEEP_AND_REOPEN", reason: "Photos do not show the damage", voidedByName: "Hannah Lee", voidedAt: "2026-11-10T22:12:00.000Z" }],
    submittedAt: "2026-11-11T00:40:00.000Z",
    reportedByName: "Maria Santos",
    jobNumber: "J-1051",
    acknowledgedAt: null,
    acknowledgedName: null,
    itemNumberById: { item1: 1 },
    earliestCaseOpenedAt: "2026-11-10T01:48:00.000Z",
  };

  it("lists submissions, the send-back, decisions and estimate changes newest first", () => {
    const history = buildDamageHistory({
      ...base,
      audits: [
        { id: "a1", action: "DAMAGE_REPORT_SUBMITTED", createdAt: "2026-11-10T01:48:00.000Z", actorName: "Maria Santos", before: null, after: { itemCount: 3, photoCount: 9 } },
        { id: "a2", action: "DAMAGE_REPORT_SUBMITTED", createdAt: "2026-11-11T00:40:00.000Z", actorName: "Maria Santos", before: null, after: { itemCount: 3, photoCount: 11 } },
        { id: "a3", action: "DAMAGE_ITEM_ESTIMATE_SET", createdAt: "2026-11-11T22:40:00.000Z", actorName: "Hannah Lee", before: { estimatedCost: null }, after: { itemId: "item1", estimatedCost: 350 } },
        { id: "a4", action: "DAMAGE_ITEM_ESTIMATE_SET", createdAt: "2026-11-11T22:41:00.000Z", actorName: "Hannah Lee", before: { estimatedCost: 350 }, after: { itemId: "item1", estimatedCost: null } },
      ],
    });
    expect(history.map((entry) => entry.lead)).toEqual(["Estimate", "Estimate", "Resubmitted", "Sent back", "Submitted"]);
    expect(history[0].detail).toContain("cleared (not estimated)");
    expect(history[1].detail).toContain("set to $350.00");
    expect(history[4].detail).toContain("from J-1051 · 3 items · 9 photos");
    expect(history[3].detail).toContain('"Photos do not show the damage"');
  });

  it("falls back to the stored submission and case times for reports from before submissions were logged", () => {
    const history = buildDamageHistory({ ...base, audits: [] });
    expect(history.map((entry) => [entry.lead, entry.at])).toEqual([
      ["Resubmitted", "2026-11-11T00:40:00.000Z"],
      ["Sent back", "2026-11-10T22:12:00.000Z"],
      ["Submitted", "2026-11-10T01:48:00.000Z"],
    ]);
  });

  it("states each release message transport's own state and never claims it was read", () => {
    const text = releaseMessageText({ outcomes: [{ transport: "INBOX", state: "inbox_available" }, { transport: "EMAIL", state: "queued" }] });
    expect(text).toBe("inbox in the inbox, email queued");
    expect(text).not.toMatch(/read|delivered/i);
    expect(releaseMessageText({ outcomes: [] })).toBeNull();
  });
});

describe("progress", () => {
  const when = (iso: string | null) => iso;
  const input = {
    status: "UNDER_REVIEW",
    firstSubmittedAt: "2026-11-10T01:48:00.000Z",
    submittedAt: "2026-11-11T00:40:00.000Z",
    voids: [{ id: "v1", mode: "KEEP_AND_REOPEN", reason: "x", voidedByName: null, voidedAt: "2026-11-10T22:12:00.000Z" }],
    clientVisible: false,
    reviewedByName: "Hannah Lee",
    reviewedAt: "2026-11-11T01:00:00.000Z",
    releasedAt: null,
    acknowledgedAt: null,
    acknowledgedName: null,
    closedAt: null,
  };

  it("shows submitted, sent back once, office review current and the rest not yet", () => {
    const stages = damageRecordStages(input, when);
    expect(stages.map((stage) => [stage.label, stage.state])).toEqual([
      ["Submitted", "done"],
      ["Sent back once", "done"],
      ["Office review", "current"],
      ["Released to client", "todo"],
      ["Client acknowledged", "todo"],
      ["Closed", "todo"],
    ]);
  });

  it("marks release and acknowledgement skipped when closed without releasing", () => {
    const stages = damageRecordStages({ ...input, status: "CLOSED", closedAt: "2026-11-12T00:00:00.000Z" }, when);
    expect(stages.find((stage) => stage.key === "released")).toMatchObject({ state: "skipped", note: "Closed without releasing" });
    expect(stages.find((stage) => stage.key === "acknowledged")?.state).toBe("skipped");
    expect(stages.find((stage) => stage.key === "closed")?.state).toBe("done");
  });

  it("waits for the cleaner while sent back", () => {
    const stages = damageRecordStages({ ...input, status: "DRAFT", submittedAt: null }, when);
    expect(stages.find((stage) => stage.key === "sent-back")).toMatchObject({ state: "current", note: "Waiting for the cleaner to resubmit" });
  });
});
