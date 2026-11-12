import { describe, expect, it } from "vitest";
import { allOpsLevels, type OpsLevels } from "@/lib/rbac/ops-catalog";
import {
  DOCUMENT_TODAY_DAYS,
  KIND_CATEGORY,
  KIND_URGENCY,
  chipCounts,
  documentUrgency,
  filterForViewer,
  sortQueue,
  unassignedUrgency,
} from "@/lib/dashboard/work-queue-rules";
import type { WorkQueueItem, WorkQueueKind } from "@/lib/dashboard/work-queue-types";

function item(kind: WorkQueueKind, overrides: Partial<WorkQueueItem> = {}): WorkQueueItem {
  return {
    id: `${kind}:1`, kind, category: KIND_CATEGORY[kind], urgency: KIND_URGENCY[kind], title: kind, detail: "", count: 1,
    href: "/v2/admin/approvals", actions: [], ...overrides,
  };
}

function levels(overrides: Partial<OpsLevels>): OpsLevels {
  return { ...allOpsLevels("manage"), ...overrides };
}

describe("urgency rules", () => {
  it("treats unassigned jobs today and tomorrow as now, later as this week", () => {
    expect(unassignedUrgency("2026-11-11", "2026-11-11")).toBe("now");
    expect(unassignedUrgency("2026-11-12", "2026-11-11")).toBe("now");
    expect(unassignedUrgency("2026-11-13", "2026-11-11")).toBe("week");
  });
  it("raises documents expiring within the named threshold to today", () => {
    const now = new Date("2026-11-11T00:00:00Z");
    expect(documentUrgency(new Date(now.getTime() + DOCUMENT_TODAY_DAYS * 86_400_000), now)).toBe("today");
    expect(documentUrgency(new Date(now.getTime() + (DOCUMENT_TODAY_DAYS + 1) * 86_400_000), now)).toBe("week");
  });
  it("has an urgency and a category for every kind", () => {
    expect(Object.keys(KIND_URGENCY).sort()).toEqual(Object.keys(KIND_CATEGORY).sort());
  });
  it("sorts most urgent first and keeps the builder order within a group", () => {
    const sorted = sortQueue([
      item("invoices-draft", { id: "a" }), item("pay-request", { id: "b" }), item("continuation", { id: "c" }), item("unassigned-soon", { id: "d" }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["c", "d", "b", "a"]);
  });
});

describe("role and pack omission", () => {
  const rows = [
    item("invoices-draft", { href: "/v2/admin/finance?tab=invoices&status=DRAFT" }),
    item("invoices-outstanding", { href: "/v2/admin/finance?tab=invoices&status=SENT" }),
    item("pay-request", { href: "/v2/admin/finance?tab=adjustments" }),
    item("shopping-reimbursement", {
      href: "/v2/admin/inventory/shopping/r1",
      actions: [{ kind: "request", label: "Approve", method: "PATCH", endpoint: "/api/admin/inventory/shopping-runs/r1", body: { cleanerReimbursementStatus: "READY" }, doneLabel: "ok" }],
    }),
    item("clock-adjustment"),
    item("continuation", {
      href: "/v2/admin/jobs/j1",
      actions: [{ kind: "request", label: "Approve", method: "PATCH", endpoint: "/api/admin/job-continuations/c1", body: { decision: "APPROVE" }, doneLabel: "ok" }],
    }),
  ];

  it("shows everything to an administrator (no packs)", () => {
    expect(filterForViewer(rows, { levels: null, readOnly: false })).toHaveLength(rows.length);
  });

  it("omits every money row for a manager without finance", () => {
    const visible = filterForViewer(rows, { levels: levels({ finance: "off" }), readOnly: false });
    expect(visible.filter((row) => row.category === "money")).toEqual([]);
    expect(visible.map((row) => row.kind)).toEqual(["clock-adjustment", "continuation"]);
  });

  it("omits pay requests without payroll", () => {
    const visible = filterForViewer(rows, { levels: levels({ payroll: "off" }), readOnly: false });
    expect(visible.map((row) => row.kind)).not.toContain("pay-request");
    expect(visible.map((row) => row.kind)).toContain("invoices-draft");
  });

  it("omits rows whose destination the manager cannot open", () => {
    const visible = filterForViewer(rows, { levels: levels({ approvals: "off" }), readOnly: false });
    expect(visible.map((row) => row.kind)).not.toContain("clock-adjustment");
  });

  it("keeps a row but drops an action the pack only allows reading", () => {
    const visible = filterForViewer(rows, { levels: levels({ approvals: "read" }), readOnly: false });
    expect(visible.find((row) => row.kind === "continuation")?.actions).toEqual([]);
  });

  it("drops every request and assign action in a read-only impersonation", () => {
    const withAssign = [...rows, item("unassigned-soon", { href: "/v2/admin/jobs/j2", actions: [{ kind: "assign", label: "Assign", jobId: "j2" }] })];
    const visible = filterForViewer(withAssign, { levels: null, readOnly: true });
    expect(visible.flatMap((row) => row.actions)).toEqual([]);
  });
});

describe("chip counts", () => {
  it("counts the records behind each row and does not add overlapping views twice", () => {
    const chips = chipCounts([
      item("clock-adjustment", { count: 7 }),
      item("case-overdue", { count: 2 }),
      item("case-open", { count: 3 }),
      item("case-high", { count: 4, overlap: true }),
      item("unassigned-soon", { count: 1 }),
    ]);
    expect(chips).toEqual([
      { key: "all", label: "All", count: 13 },
      { key: "dispatch", label: "Dispatch", count: 1 },
      { key: "approvals", label: "Approvals", count: 7 },
      { key: "clients", label: "Clients", count: 5 },
    ]);
  });
});
