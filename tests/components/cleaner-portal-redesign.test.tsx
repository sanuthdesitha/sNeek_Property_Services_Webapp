import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLEANER_MORE_SECTIONS,
  CLEANER_RAIL,
  CLEANER_TABS,
  isCleanerJobScreen,
  moreItemVisible,
} from "@/components/v2/cleaner/portal/portal-nav";
import { cleanerTabBadges, countWaitingAsks } from "@/components/v2/cleaner/portal/tab-badges";
import { mobileTabs } from "@/lib/navigation/mobile-tabs";
import { ClockStateCard } from "@/components/v2/cleaner/today/today-cards";
import { SubmitBlockers } from "@/components/v2/cleaner/job-stages/submit-blockers";
import { todaySummaryLine, durationLabel } from "@/lib/cleaner/today-view";
import { resolveSuppliesTab, suppliesTabs } from "@/lib/cleaner/supplies-view";
import { payPeriodLines, resolvePayTab } from "@/lib/cleaner/pay-view";
import { guestCountdownLabel } from "@/lib/cleaner/job-screen-view";
import { clockInBlockedReason } from "@/components/v2/cleaner/job-stages/stage-footer";

const maintenance = vi.hoisted(() => ({ assigned: false, count: 0 }));
vi.mock("@/components/v2/portal/use-maintenance-section", () => ({ useMaintenanceSection: () => maintenance }));
vi.mock("@/components/v2/portal/role-switcher", () => ({ RoleSwitcher: () => <p>Role switcher</p> }));
vi.mock("@/components/look-switch-link", () => ({ LookSwitchLink: () => <a href="/cleaner">Classic look</a> }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, status: "unauthenticated" }) }));

import { CleanerMoreMenu } from "@/components/v2/cleaner/portal/more-menu";

afterEach(() => {
  cleanup();
  maintenance.assigned = false;
  maintenance.count = 0;
});

describe("cleaner tab bar", () => {
  it("offers exactly the drawn five tabs in order, each found in the supplied nav", () => {
    expect(CLEANER_TABS.map((tab) => tab.label)).toEqual(["Today", "Jobs", "Supplies", "Pay", "More"]);
    const nav = CLEANER_TABS.map((tab) => ({ href: tab.href }));
    expect(mobileTabs("cleaner", nav).map((item) => item.href)).toEqual([
      "/v2/cleaner", "/v2/cleaner/jobs", "/v2/cleaner/supplies", "/v2/cleaner/pay", "/v2/cleaner/more",
    ]);
  });

  it("gives every former destination a tab, a rail entry or a More entry", () => {
    const homes = new Set<string>([
      ...CLEANER_TABS.flatMap((tab) => [tab.href, ...tab.activePrefixes]),
      ...CLEANER_RAIL.map((item) => item.href),
      ...CLEANER_MORE_SECTIONS.flatMap((section) => section.items.map((item) => item.href.split("?")[0])),
    ]);
    for (const path of ["route", "calendar", "quality", "lost-found", "maintenance", "availability", "hub", "profile", "settings",
      "supplies", "pay", "invoices", "pay-requests", "shopping", "stock-count", "quick-scan", "restock", "stock-runs", "jobs"]) {
      expect(homes.has(`/v2/cleaner/${path}`), path).toBe(true);
    }
  });

  it("hides the portal chrome only on one job's screen", () => {
    expect(isCleanerJobScreen("/v2/cleaner/jobs/job-1")).toBe(true);
    expect(isCleanerJobScreen("/v2/cleaner/jobs")).toBe(false);
    expect(isCleanerJobScreen("/v2/cleaner")).toBe(false);
  });

  it("puts each count on the tab that resolves it and ignores unreadable ask lists", () => {
    const badges = cleanerTabBadges({ attention: { "/v2/cleaner": 2, "/v2/cleaner/quality": 1, "/v2/cleaner/pay-requests": 3 }, maintenanceCount: 2, waitingAsks: 4 });
    expect(badges["/v2/cleaner/more"]).toBe(3);
    expect(badges["/v2/cleaner/supplies"]).toBe(4);
    expect(badges["/v2/cleaner/pay"]).toBe(3);
    expect(countWaitingAsks({ asks: [{ state: "ASKED" }, { state: "ACCEPTED" }] })).toBe(1);
    expect(countWaitingAsks({ error: "no" })).toBeNull();
  });
});

describe("More menu", () => {
  it("lists every Work and You destination with its board label, plus account actions", () => {
    render(<CleanerMoreMenu modules={{}} />);
    for (const label of ["Route and driving mode", "Schedule, month view", "QA feedback", "Lost and found",
      "Availability and leave", "Documents", "Team hub", "Profile", "Settings"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /Documents/ })).toHaveAttribute("href", "/v2/cleaner/hub?tab=documents");
    expect(screen.queryByRole("link", { name: /Maintenance/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("is role filtered: maintenance only while assigned, module-gated entries hidden when off", () => {
    maintenance.assigned = true;
    maintenance.count = 2;
    render(<CleanerMoreMenu modules={{ calendar: false, lostFound: false }} />);
    expect(screen.getByRole("link", { name: /Maintenance/ })).toHaveTextContent("2");
    expect(screen.queryByRole("link", { name: /Schedule, month view/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Lost and found/ })).toBeNull();
    const item = CLEANER_MORE_SECTIONS[0].items.find((entry) => entry.module === "calendar")!;
    expect(moreItemVisible(item, {}, false)).toBe(true);
  });
});

describe("Today card states", () => {
  it("shows not clocked in, clocked in and an unknown clock distinctly", () => {
    const { rerender } = render(<ClockStateCard state={{ kind: "not-clocked-in" }} />);
    expect(screen.getByText("Not clocked in")).toBeInTheDocument();
    rerender(<ClockStateCard state={{ kind: "clocked-in", jobId: "j1", propertyName: "Bondi Studio", since: "10:02" }} />);
    expect(screen.getByText("Clocked in")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open job/ })).toHaveAttribute("href", "/v2/cleaner/jobs/j1");
    rerender(<ClockStateCard state={{ kind: "unknown" }} />);
    expect(screen.getByText("Clock unknown")).toBeInTheDocument();
    expect(screen.queryByText("Not clocked in")).toBeNull();
  });

  it("words the summary and durations honestly", () => {
    expect(todaySummaryLine(3, 1)).toBe("3 accepted jobs today · 1 offer waiting");
    expect(todaySummaryLine(0, 0)).toBe("No accepted jobs scheduled today.");
    expect(todaySummaryLine(null, null)).toBe("Your shift could not be loaded.");
    expect(durationLabel(210, null)).toBe("3 h 30");
    expect(durationLabel(null, null)).toBeNull();
  });
});

describe("Before you submit", () => {
  const props = {
    syncBlockers: ["1 photo is still on this phone."],
    tasksPending: true,
    formErrors: [{ fieldId: "oven", label: "Oven photo", sectionLabel: "Kitchen" }],
    laundryErrors: ["A laundry photo is required when laundry is ready."],
    onJumpToTasks: vi.fn(),
    onJumpToField: vi.fn(),
    onJumpToLaundry: vi.fn(),
  };

  it("lists only blockers as jump links and keeps on-phone items apart", () => {
    render(<SubmitBlockers {...props} />);
    const checks = within(screen.getByLabelText("Submission checks"));
    expect(checks.getByText("4 checks to finish")).toBeInTheDocument();
    fireEvent.click(checks.getByRole("button", { name: /Kitchen: Oven photo/ }));
    expect(props.onJumpToField).toHaveBeenCalledWith("oven");
    fireEvent.click(checks.getByRole("button", { name: /laundry photo is required/ }));
    expect(props.onJumpToLaundry).toHaveBeenCalledOnce();
    fireEvent.click(checks.getByRole("button", { name: /Mark every checklist/ }));
    expect(props.onJumpToTasks).toHaveBeenCalledOnce();
    expect(checks.queryByRole("button", { name: /still on this phone/ })).toBeNull();
    expect(checks.getByText("1 photo is still on this phone.")).toBeInTheDocument();
  });

  it("says nothing stops the submit when there are no blockers", () => {
    render(<SubmitBlockers {...props} syncBlockers={[]} tasksPending={false} formErrors={[]} laundryErrors={[]} />);
    expect(screen.getByText("Nothing stops the submit.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Submission checks")).toBeNull();
  });

  it("explains why clock-in is not available", () => {
    const base = { clockInDisabled: true, startGateBlocks: true, propertyCodeConfirmed: false, laundryBagConfirmRequired: true, laundryBagConfirmed: false };
    expect(clockInBlockedReason(base)).toBe("Tick both boxes above first.");
    expect(clockInBlockedReason({ ...base, propertyCodeConfirmed: true, laundryBagConfirmed: true })).toMatch(/needs a connection/);
    expect(clockInBlockedReason({ ...base, clockInDisabled: false })).toBeNull();
  });
});

describe("Supplies, Pay and job header models", () => {
  it("keeps old supplies links and refuses disabled modules", () => {
    const on = { shopping: true, stockRuns: true };
    expect(suppliesTabs(on).map((tab) => tab.label)).toEqual(["To do", "Shopping", "Counts", "Urgent", "My stock"]);
    expect(resolveSuppliesTab("restock", undefined, on)).toEqual({ tab: "counts", tool: "restock" });
    expect(resolveSuppliesTab("quick-scan", undefined, on)).toEqual({ tab: "counts", tool: "quick-scan" });
    expect(resolveSuppliesTab("stock-runs", undefined, on)).toEqual({ tab: "counts", tool: "stock-runs" });
    expect(resolveSuppliesTab("shopping", undefined, { shopping: false, stockRuns: false }).tab).toBe("todo");
    expect(resolveSuppliesTab("stock-runs", undefined, { shopping: false, stockRuns: false })).toEqual({ tab: "todo", tool: "quick-scan" });
  });

  it("regroups only the server's totals and adds up to its estimate", () => {
    const data = {
      rows: [{ amount: 100 }, { amount: 27.75 }],
      shoppingTimeRows: [{ minutes: 30 }],
      shoppingTimeTotal: 18.25,
      expenseTotal: 41.6,
      extraLineTotal: 0,
      qaInspectionTotal: 0,
      transportAllowanceTotal: 0,
    } as unknown as Parameters<typeof payPeriodLines>[0];
    const lines = payPeriodLines(data);
    expect(lines.map((line) => line.label)).toEqual(["Cleaning jobs", "Shopping time, 0.5 h", "Reimbursements"]);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(187.6);
    expect(resolvePayTab("invoices")).toBe("invoices");
    expect(resolvePayTab("nope")).toBe("period");
  });

  it("counts down to guest arrival only on the job's Sydney day", () => {
    const now = new Date("2026-11-12T01:48:00Z"); // 12:48 in Sydney (AEDT)
    expect(guestCountdownLabel("2026-11-12", "15:00", now)).toBe("2 h 12 m to guest arrival");
    expect(guestCountdownLabel("2026-11-13", "15:00", now)).toBeNull();
    expect(guestCountdownLabel("2026-11-12", "12:00", now)).toBe("Guest arrival time passed");
    expect(guestCountdownLabel("2026-11-12", null, now)).toBeNull();
  });
});
