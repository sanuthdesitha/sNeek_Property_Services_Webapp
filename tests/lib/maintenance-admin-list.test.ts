import { describe, expect, it } from "vitest";
import { maintenanceAttention, isNobodyAssigned, NOBODY_ASSIGNED_ATTENTION_DAYS } from "@/lib/maintenance/attention";
import { buildMaintenanceListWhere, calendarRanges, maintenanceListOrder, parseMaintenanceListFilters } from "@/lib/maintenance/admin-list";
import { maintenanceRecordStages } from "@/lib/maintenance/record-stages";
import { isListQueryError } from "@/lib/admin/list-query";
import { readMaintenanceView, viewSearch, safeBackHref } from "@/components/v2/admin/maintenance/maintenance-view";
import { costSummary, visitParts } from "@/components/v2/admin/maintenance/maintenance-format";
import { visitInstant } from "@/components/v2/admin/maintenance/visit-sheet";

const NOW = new Date("2026-11-14T02:00:00Z"); // Sat 14 Nov, 13:00 Sydney
const base = { status: "OPEN", priority: "MEDIUM", costApprovalStatus: null, pricePending: false, assignedWorkerId: null, activeRosterCount: 0, createdAt: new Date("2026-11-13T23:00:00Z") };

describe("maintenance attention (owner defaults 2026-11-14)", () => {
  it("nobody assigned means no visit worker and nobody active in the roster", () => {
    expect(isNobodyAssigned({ assignedWorkerId: null, activeRosterCount: 0 })).toBe(true);
    expect(isNobodyAssigned({ assignedWorkerId: "w1", activeRosterCount: 0 })).toBe(false);
    expect(isNobodyAssigned({ assignedWorkerId: null, activeRosterCount: 1 })).toBe(false);
  });

  it("orders reasons: urgent and nobody, urgent and open, client declined, price request, nobody for more than two days", () => {
    expect(maintenanceAttention({ ...base, priority: "URGENT" }, NOW)).toEqual({ tone: "problem", reason: "Nobody assigned" });
    expect(maintenanceAttention({ ...base, priority: "URGENT", assignedWorkerId: "w" }, NOW)).toEqual({ tone: "problem", reason: "Urgent" });
    expect(maintenanceAttention({ ...base, assignedWorkerId: "w", status: "ACKNOWLEDGED", costApprovalStatus: "DECLINED" }, NOW)).toEqual({ tone: "attention", reason: "Client declined price" });
    expect(maintenanceAttention({ ...base, assignedWorkerId: "w", pricePending: true }, NOW)).toEqual({ tone: "attention", reason: "Price request" });
    expect(maintenanceAttention(base, NOW)).toBeNull();
    const old = new Date(NOW.getTime() - (NOBODY_ASSIGNED_ATTENTION_DAYS * 86_400_000 + 3_600_000));
    expect(maintenanceAttention({ ...base, createdAt: old }, NOW)).toEqual({ tone: "attention", reason: "Nobody assigned, 2 days" });
  });

  it("a resolved or dismissed item never needs anyone, even when declined", () => {
    expect(maintenanceAttention({ ...base, status: "RESOLVED", priority: "URGENT", costApprovalStatus: "DECLINED" }, NOW)).toBeNull();
    expect(maintenanceAttention({ ...base, status: "DISMISSED", priority: "URGENT" }, NOW)).toBeNull();
  });
});

describe("admin list filters", () => {
  it("reads every filter and refuses unknown values with a list query error", () => {
    const filters = parseMaintenanceListFilters(new URLSearchParams("status=ORDERED&priority=HIGH,URGENT&category=PLUMBING&source=CLEANER&assigned=none&price=DECLINED&visible=no&period=visits-week&q=tap"));
    expect(filters).toMatchObject({ status: "ORDERED", priority: ["HIGH", "URGENT"], category: "PLUMBING", source: ["CLEANER"], assigned: "none", price: "DECLINED", visible: "no", period: "visits-week", q: "tap" });
    for (const bad of ["status=CLOSED", "priority=EXTREME", "category=CARS", "assigned=everyone", "price=PAID", "visible=maybe", "propertyId=../x"]) {
      try {
        parseMaintenanceListFilters(new URLSearchParams(bad));
        throw new Error(`accepted ${bad}`);
      } catch (error) {
        expect(isListQueryError(error), bad).toBe(true);
      }
    }
  });

  it("builds the where clause: nobody assigned, client price not sent, open statuses", () => {
    const ranges = calendarRanges(NOW, "Australia/Sydney");
    const where = buildMaintenanceListWhere(parseMaintenanceListFilters(new URLSearchParams("assigned=none&price=NOT_SENT")), ranges) as { AND: unknown[] };
    expect(where.AND).toContainEqual({ status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ORDERED"] } });
    expect(where.AND).toContainEqual({ assignedWorkerId: null, roleAssignments: { none: { removedAt: null } } });
    expect(where.AND).toContainEqual({ costApprovalStatus: null });
    const worker = buildMaintenanceListWhere(parseMaintenanceListFilters(new URLSearchParams("assigned=worker:w1&status=RESOLVED")), ranges) as { AND: unknown[] };
    expect(worker.AND).toContainEqual({ assignedWorkerId: "w1" });
    expect(worker.AND).toContainEqual({ status: "RESOLVED" });
  });

  it("uses the organisation's week (Monday to Sunday) and month, not the server's", () => {
    const ranges = calendarRanges(NOW, "Australia/Sydney");
    expect(ranges.weekStart.toISOString()).toBe("2026-11-08T13:00:00.000Z"); // Mon 9 Nov 00:00 Sydney
    expect(ranges.weekEnd.toISOString()).toBe("2026-11-15T13:00:00.000Z");
    expect(ranges.monthStart.toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(ranges.todayStart.toISOString()).toBe("2026-11-13T13:00:00.000Z");
  });

  it("sorts by priority, then oldest first, with a stable tail; missing visits and costs go last", () => {
    expect(maintenanceListOrder("priority", "desc")).toEqual([{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }]);
    expect(maintenanceListOrder("visit", "asc")[0]).toEqual({ scheduledFor: { sort: "asc", nulls: "last" } });
    expect(maintenanceListOrder("cost", "desc").slice(0, 2)).toEqual([{ quotedCost: { sort: "desc", nulls: "last" } }, { estimatedCost: { sort: "desc", nulls: "last" } }]);
  });
});

describe("item page stages", () => {
  const input = { status: "IN_PROGRESS", createdAt: "2026-11-10T00:42:00Z", acknowledgedAt: null, assignedAt: "2026-11-11T22:05:00Z", someoneAssigned: true, scheduledFor: "2026-11-12T21:00:00Z", arrivedAt: null, clockInAt: null, clockOutAt: null, outcome: null, resolvedAt: null };
  it("marks recorded steps done, an unrecorded earlier step as recorded by status only, and the latest step current", () => {
    const states = maintenanceRecordStages(input, () => null).map((stage) => `${stage.key}:${stage.state}`);
    expect(states).toEqual(["reported:done", "acknowledged:done", "assigned:done", "visit:current", "on-site:todo", "work-done:todo", "resolved:todo"]);
  });
  it("never claims a step happened without a fact: no visit booked stays passed when the worker arrived anyway", () => {
    const states = maintenanceRecordStages({ ...input, scheduledFor: null, arrivedAt: "2026-11-13T00:00:00Z" }, () => null).map((stage) => stage.state);
    expect(states[3]).toBe("passed");
    expect(states[4]).toBe("current");
  });
});

describe("view, wording and visit time", () => {
  it("keeps old links working and drops unknown values", () => {
    expect(readMaintenanceView("").tab).toBe("items");
    expect(readMaintenanceView("?status=OPEN&priority=URGENT,BOGUS&assigned=bad value&open=abc").priority).toEqual(["URGENT"]);
    expect(readMaintenanceView("?assigned=bad value").assigned).toBe("any");
    const view = readMaintenanceView("?tab=people&price=PENDING&page=2");
    expect(viewSearch(view)).toBe("?tab=people&price=PENDING&page=2");
    expect(safeBackHref("https://evil.example")).toBe("/v2/admin/maintenance");
    expect(safeBackHref("/v2/admin/maintenance?status=OPEN")).toBe("/v2/admin/maintenance?status=OPEN");
  });

  it("never turns a missing cost or visit into zero or today", () => {
    expect(costSummary({ quotedCost: null, estimatedCost: null, costApprovalStatus: null })).toEqual({ amount: null, note: "Not estimated", tone: "muted" });
    expect(costSummary({ quotedCost: 240, estimatedCost: 180, costApprovalStatus: "PENDING" })).toMatchObject({ amount: "$240.00", note: "Awaiting client" });
    expect(costSummary({ quotedCost: null, estimatedCost: null, costApprovalStatus: "DECLINED" }).amount).toBeNull();
    expect(visitParts(null, "Australia/Sydney")).toBeNull();
    expect(visitParts("2026-11-12T21:00:00Z", "Australia/Sydney", NOW)).toEqual({ day: "Fri 13 Nov", time: "08:00" });
  });

  it("reads the visit time in the organisation's timezone; empty is not booked; half a time is refused", () => {
    expect(visitInstant("", "", "Australia/Sydney")).toEqual({ iso: null, error: null });
    expect(visitInstant("2026-11-13", "08:00", "Australia/Sydney").iso).toBe("2026-11-12T21:00:00.000Z");
    expect(visitInstant("2026-11-13", "", "Australia/Sydney").error).toMatch(/both a date and a time/);
  });
});
