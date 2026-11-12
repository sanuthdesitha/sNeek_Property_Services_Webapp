import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MaintenanceOutcome, Role } from "@prisma/client";
import { mobileTabs } from "@/lib/navigation/mobile-tabs";
import { buildTabbedNav } from "@/lib/navigation/tabbed-nav";
import { portalMoreSectionsFor } from "@/lib/navigation/portal-more";
import { QA_MAINTENANCE_RAIL_ITEM, QA_MORE_SECTIONS, QA_RAIL, QA_TABS } from "@/components/v2/qa/portal/qa-nav";
import {
  MAINTENANCE_MORE_SECTIONS,
  MAINTENANCE_RAIL,
  MAINTENANCE_TABS,
} from "@/components/v2/maintenance/portal/maintenance-nav";
import { buildQaPayHeadline, OFFICE_TO_FIX, qaPayLineAmount } from "@/lib/qa/pay-view";
import { buildVisitOrderRows, moveVisit, nextVisit, visitPayLabel } from "@/lib/qa/visit-order-view";
import { VISIT_OUTCOMES } from "@/lib/maintenance/visit-outcomes";
import { visitStages } from "@/lib/maintenance/visit-stages";
import { groupTicketsByDay } from "@/lib/maintenance/tickets-by-day";
import type { MaintenanceTicketSummary } from "@/lib/maintenance/ticket-stage";
import type { QaPayLine, QaPaySummary } from "@/lib/qa/pay";

const maintenance = vi.hoisted(() => ({ assigned: false, count: 0 }));
const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), paySummary: vi.fn() }));
vi.mock("@/components/v2/portal/use-maintenance-section", () => ({ useMaintenanceSection: () => maintenance }));
vi.mock("@/components/v2/portal/role-switcher", () => ({ RoleSwitcher: () => <p>Role switcher</p> }));
vi.mock("@/components/look-switch-link", () => ({ LookSwitchLink: () => <a href="/qa">Classic look</a> }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, status: "unauthenticated" }) }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/qa/pay", () => ({ getQaPaySummary: mocks.paySummary }));

import V2QaMorePage from "@/app/v2/qa/more/page";
import V2MaintenanceMorePage from "@/app/v2/maintenance/more/page";
import QaPayPage from "@/app/v2/qa/pay/page";
import { OutcomeChoice } from "@/components/v2/maintenance/visit/outcome-choice";

afterEach(() => {
  cleanup();
  maintenance.assigned = false;
  maintenance.count = 0;
  vi.clearAllMocks();
});

function hrefsOf(sections: ReturnType<typeof portalMoreSectionsFor>): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.href));
}

describe("QA tab bar and More", () => {
  it("shows the five drawn tabs in order on a phone", () => {
    const nav = buildTabbedNav({ rail: QA_RAIL, tabs: QA_TABS });
    const tabs = mobileTabs("qa", nav);
    expect(tabs.map((tab) => tab.label)).toEqual(["Today", "Reviews", "Rework", "Pay", "More"]);
    expect(tabs.map((tab) => tab.href)).toEqual(["/v2/qa", "/v2/qa/reviews", "/v2/qa/rework", "/v2/qa/pay", "/v2/qa/more"]);
    // More is phone-only; it never appears in the desktop rail.
    expect(nav.find((item) => item.href === "/v2/qa/more")?.mobileOnly).toBe(true);
  });

  it("keeps a home for every destination the old QA nav had", () => {
    const before = ["/v2/qa", "/v2/qa/reviews", "/v2/qa/rework", "/v2/qa/pay", "/v2/qa/stats", "/v2/qa/invoices", "/v2/qa/profile", "/v2/qa/maintenance"];
    const more = hrefsOf(portalMoreSectionsFor(QA_MORE_SECTIONS, { office: false, maintenanceAssigned: true }));
    const tabs = QA_TABS.map((tab) => tab.href);
    for (const href of before) expect([...tabs, ...more]).toContain(href);
    const rail = buildTabbedNav({ rail: QA_RAIL, tabs: QA_TABS, extra: [QA_MAINTENANCE_RAIL_ITEM] }).map((item) => item.href);
    for (const href of before) expect(rail).toContain(href);
  });

  it("filters More by assignment and office role", () => {
    const inspector = hrefsOf(portalMoreSectionsFor(QA_MORE_SECTIONS, { office: false, maintenanceAssigned: false }));
    expect(inspector).not.toContain("/v2/qa/maintenance");
    expect(inspector).not.toContain("/v2/qa#office-queue-tools");
    const office = portalMoreSectionsFor(QA_MORE_SECTIONS, { office: true, maintenanceAssigned: true });
    expect(office.map((section) => section.title)).toContain("Office-only queue tools");
  });

  it("serves the old /v2/qa/more URL as the menu, office tools only for the office", async () => {
    mocks.requireRole.mockResolvedValue({ user: { id: "qa-1", role: Role.QA_INSPECTOR } });
    render(await V2QaMorePage());
    expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Stats/ })).toHaveAttribute("href", "/v2/qa/stats");
    expect(screen.getByRole("link", { name: /Invoices/ })).toHaveAttribute("href", "/v2/qa/invoices");
    expect(screen.queryByRole("link", { name: /Maintenance/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Office-only queue tools")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    cleanup();
    maintenance.assigned = true;
    maintenance.count = 2;
    mocks.requireRole.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    render(await V2QaMorePage());
    expect(screen.getByRole("link", { name: /Maintenance/ })).toHaveAttribute("href", "/v2/qa/maintenance");
    expect(screen.getByText("Office-only queue tools")).toBeVisible();
  });
});

describe("maintenance tab bar and More", () => {
  it("shows Today, Tickets, Replacements, Log, More and keeps Settings reachable", async () => {
    const nav = buildTabbedNav({ rail: MAINTENANCE_RAIL, tabs: MAINTENANCE_TABS });
    expect(mobileTabs("maintenance", nav).map((tab) => tab.label)).toEqual(["Today", "Tickets", "Replacements", "Log", "More"]);
    const more = hrefsOf(portalMoreSectionsFor(MAINTENANCE_MORE_SECTIONS, { office: false, maintenanceAssigned: false }));
    for (const href of ["/v2/maintenance", "/v2/maintenance/tickets", "/v2/maintenance/replacements", "/v2/maintenance/log", "/v2/maintenance/settings"]) {
      expect([...MAINTENANCE_TABS.map((tab) => tab.href), ...more]).toContain(href);
      expect(nav.map((item) => item.href)).toContain(href);
    }
    mocks.requireRole.mockResolvedValue({ user: { id: "m-1", role: Role.MAINTENANCE } });
    render(await V2MaintenanceMorePage());
    expect(screen.getByRole("link", { name: /Settings/ })).toHaveAttribute("href", "/v2/maintenance/settings");
  });
});

const line = (overrides: Partial<QaPayLine>): QaPayLine => ({
  id: "a", jobId: "job-a", jobNumber: null, property: "Glebe House", suburb: null, completedAt: new Date("2026-11-10T03:00:00Z"),
  mode: "FIXED", basis: "NONE", hours: 0, rate: 0, amount: 45, rateMissing: false, note: null,
  settlement: "PENDING", settledBy: null, settledVia: null, settledByLabel: null, ...overrides,
});

function summary(inspections: QaPayLine[]): QaPaySummary {
  const pay = inspections.reduce((sum, row) => sum + row.amount, 0);
  return {
    start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-11-15T00:00:00Z"), inspections, adjustments: [],
    totals: { inspectionCount: inspections.length, inspectionHours: 0, inspectionPay: pay, approvedAdjustments: 0, pendingAdjustments: 0, total: pay, settled: 0, unsettled: pay },
  };
}

describe("QA pay never shows an unset rate as zero", () => {
  it("labels the line and the breakdown Office to fix, and marks the total not final", () => {
    const missing = line({ id: "b", property: "Manly Loft", amount: 0, rateMissing: true });
    expect(qaPayLineAmount(missing)).toBe(OFFICE_TO_FIX);
    const headline = buildQaPayHeadline(summary([line({}), missing]));
    expect(headline.breakdown.find((row) => row.key === "office")?.value).toBe(OFFICE_TO_FIX);
    expect(headline.breakdown.find((row) => row.key === "priced")?.label).toBe("1 priced inspection");
    expect(headline.incompleteNote).toMatch(/Not final/);
  });

  it("renders the Pay page without $0.00 for the unpriced inspection", async () => {
    mocks.requireRole.mockResolvedValue({ user: { id: "qa-1", role: Role.QA_INSPECTOR } });
    mocks.paySummary.mockResolvedValue(summary([line({}), line({ id: "b", property: "Manly Loft", amount: 0, rateMissing: true })]));
    render(await QaPayPage({}));
    const row = screen.getByRole("link", { name: "Manly Loft" }).closest("div.flex") as HTMLElement;
    expect(within(row.parentElement as HTMLElement).getByText(OFFICE_TO_FIX)).toBeVisible();
    expect(within(row.parentElement as HTMLElement).queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Invoice this work" })[0]).toHaveAttribute("href", "/v2/qa/invoices");
  });

  it("never prices a planned visit at $0.00 when no rate is set", () => {
    const label = visitPayLabel({ id: "a", jobId: "j", payMode: "FIXED", payAmount: null }, { defaultMode: "FIXED", defaultFixedAmount: 0 } as never);
    expect(label).toBe("Rate not set · office to fix");
  });
});

describe("QA visit order", () => {
  const assignment = (id: string, readiness: string, extra: Record<string, unknown> = {}) => ({
    id, jobId: `job-${id}`, status: "ASSIGNED", inspectionReadiness: readiness,
    job: { status: readiness === "READY" ? "SUBMITTED" : "IN_PROGRESS", property: { name: `Property ${id}` }, assignments: [{ user: { name: "Marco R." } }], formSubmissions: [] },
    ...extra,
  });

  it("marks a clean in progress as Wait and picks the first open stop as next", () => {
    const rows = buildVisitOrderRows([assignment("1", "CLEANING"), assignment("2", "READY")], null);
    expect(rows.map((row) => row.readiness.label)).toEqual(["Wait", "Ready"]);
    expect(rows[0].waitingForCleaner).toBe(true);
    expect(nextVisit(rows)?.assignmentId).toBe("1");
    expect(moveVisit(rows, 0, 1)?.map((row) => [row.assignmentId, row.position])).toEqual([["2", 1], ["1", 2]]);
    expect(moveVisit(rows, 0, -1)).toBeNull();
  });
});

describe("maintenance finish and schedule", () => {
  it("keeps every stored outcome, in order, as a radio choice", () => {
    expect(VISIT_OUTCOMES.map((option) => option.value).sort()).toEqual(Object.values(MaintenanceOutcome).sort());
    expect(VISIT_OUTCOMES.map((option) => option.value)).toEqual(["FIXED", "REPLACED", "NEEDS_PARTS", "NEEDS_FOLLOWUP", "NO_ACCESS", "NO_ISSUE_FOUND", "OTHER"]);
    const onChange = vi.fn();
    render(<OutcomeChoice value="FIXED" onChange={onChange} />);
    expect(screen.getAllByRole("radio")).toHaveLength(VISIT_OUTCOMES.length);
    screen.getByRole("radio", { name: /Needs parts/ }).click();
    expect(onChange).toHaveBeenCalledWith("NEEDS_PARTS");
  });

  it("maps visit stages from recorded times only", () => {
    const base = { status: "ACKNOWLEDGED", enRouteAt: null, arrivedAt: null, clockInAt: null, clockOutAt: null, resolvedAt: null, outcome: null };
    expect(visitStages(base).map((stage) => stage.state)).toEqual(["done", "current", "todo", "todo"]);
    // Clocked in without "on the way": that optional step is passed, never done.
    expect(visitStages({ ...base, clockInAt: "2026-11-12T00:00:00Z" }).map((stage) => stage.state)).toEqual(["done", "passed", "done", "current"]);
    expect(visitStages({ ...base, outcome: "FIXED", clockInAt: "x", enRouteAt: "y" })[3].state).toBe("done");
  });

  it("groups tickets by Sydney day: today, later, overdue, then unscheduled", () => {
    const ticket = (id: string, scheduledFor: string | null): MaintenanceTicketSummary => ({
      id, title: id, priority: "HIGH", status: "OPEN", scheduledFor, enRouteAt: null, arrivedAt: null, clockInAt: null,
      clockOutAt: null, outcome: null, costApprovalStatus: null, property: null,
    });
    const groups = groupTicketsByDay(
      [ticket("later", "2026-11-13T02:00:00Z"), ticket("none", null), ticket("today", "2026-11-12T03:00:00Z"), ticket("old", "2026-11-10T03:00:00Z")],
      new Date("2026-11-12T01:00:00Z"),
    );
    expect(groups.map((group) => group.label)).toEqual(["Today", "Friday 13 Nov", "Tuesday 10 Nov · overdue", "Not scheduled"]);
  });
});
