/**
 * Quality on a phone (board "M-PeopleQuality", 2026-11): one Filter sheet for
 * the shared filters (and the Issues tab's status filters), cleaner cards that
 * open a cleaner screen with the rating mix, categories, the issues and their
 * actions and the row's action at the bottom, issue cards with Mark fixed and
 * "⋯". Nothing changes from 640px up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { CleanersTab } from "@/components/v2/admin/quality/hub/cleaners-tab";
import { IssuesTab } from "@/components/v2/admin/quality/hub/issues-tab";
import { SharedFilters } from "@/components/v2/admin/quality/hub/shared-filters";
import type { CleanerRow, HubContext } from "@/components/v2/admin/quality/hub/hub-types";
import { EMPTY_ISSUE_FILTERS as DEFAULT_ISSUE_FILTERS } from "@/lib/quality/types";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

const context: HubContext = { canManage: true, inspectorView: false, timeZone: "Australia/Sydney", falseConfirmationDeduction: 10 };

const ROW: CleanerRow = {
  cleanerId: "c1", name: "Marco Rossi", active: true, cleans: 24, reviewed: 20, avgScore: 81,
  ratingMix: { EXCELLENT: 6, PASS: 12, NEEDS_IMPROVEMENT: 3, FAILED: 1, MANAGEMENT_REVIEW: 0, unrated: 2 },
  trend: [], issues: { total: 10, bySeverity: { MINOR: 5, MAJOR: 3, CRITICAL: 2 } },
  topCategory: { category: "linen", label: "Linen and beds", count: 4 },
  categories: [{ category: "linen", label: "Linen and beds", count: 4 }, { category: "kitchen", label: "Kitchen", count: 3 }],
  openFixes: 2, falseConfirmations: { suspected: 1, confirmed: 0 }, streak: { currentStreak: 0, last5Avg: 80, last10Avg: 82, sample: 10 },
  pendingBonuses: [], openCoaching: 0,
  coachingSuggestion: { category: "linen", label: "Linen and beds", count: 4, windowDays: 30, patternKey: "cleaner:c1:linen", issueIds: ["i1"] },
  action: "start-coaching",
};

function issue(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, category: "linen", severity: "CRITICAL", description: "Bed made with stained sheet", rectificationStatus: "PENDING",
    rectificationMinutes: null, rectificationCost: null, rectificationBeforeKeys: null, rectificationAfterKeys: null,
    falseConfirmation: "NONE", guestReadyImpact: false, cleanerMarkedComplete: false, qaPhotoKeys: [], escalatedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), jobId: "job1", propertyId: "p1", cleanerId: "c1",
    job: { id: "job1", jobNumber: "J1", scheduledDate: null, propertyName: "Manly Loft", propertySuburb: null },
    property: null, cleaner: { id: "c1", name: "Marco Rossi" }, raisedBy: { id: "q1", name: "QA Dana" }, rectifiedBy: null, review: null, payAdjustment: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/admin/quality/cleaners")) return Response.json({ rows: [ROW], period: { key: "30d", fromKey: null, toKey: "2026-11-13" } });
    if (String(url).startsWith("/api/admin/quality/issues")) {
      return Response.json({ rows: [issue("i1"), issue("i2", { falseConfirmation: "SUSPECTED", description: "Ticked oven cleaned" })], total: 2, page: 1, pageSize: 25, pageCount: 1, sort: "created", dir: "desc" });
    }
    return Response.json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCleaners() {
  return render(
    <CleanersTab apiQuery="period=30d" sort="score" dir="desc" context={context} labelFor={(key) => key} refreshToken={0} hrefForTab={() => "/v2/admin/quality?tab=issues"} onSort={vi.fn()} onOpenIssue={vi.fn()} onChanged={vi.fn()} />,
  );
}

describe("Cleaners on a phone", () => {
  it("shows a card per cleaner with its action, and opens the cleaner screen with the rating mix, categories and issue actions", async () => {
    setPhone(true);
    renderCleaners();
    const list = await screen.findByRole("list", { name: "Cleaners" });
    expect(within(list).getByRole("button", { name: "Start coaching" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sort Cleaners by" })).toHaveValue("score");

    fireEvent.click(within(list).getByRole("button", { name: "Open Marco Rossi" }));
    const back = await screen.findByRole("button", { name: "Back to cleaners" });
    expect(screen.getByRole("heading", { name: "Marco Rossi" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Rating mix" })).toHaveTextContent("Failed 1");
    expect(screen.getByText("Linen and beds")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Mark fixed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Propose deduction" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm, −10" })).toBeTruthy();
    // Start coaching stays reachable at the bottom of the screen and opens the existing dialog.
    fireEvent.click(screen.getByRole("button", { name: "Start coaching" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(back);
  });

  it("from 640px up keeps the sortable table with expandable rows", async () => {
    setPhone(false);
    renderCleaners();
    expect(await screen.findByRole("table", { name: "Cleaners" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Cleaners" })).toBeNull();
  });
});

/** The Severity filter popover's trigger (the table's sort header is also named Severity). */
const severityFilter = () => screen.queryAllByRole("button", { name: /^Severity/ }).filter((button) => button.hasAttribute("aria-expanded"));

describe("Issues on a phone", () => {
  function renderIssues(onOpenIssueAction = vi.fn()) {
    render(
      <IssuesTab apiQuery="period=30d" filters={DEFAULT_ISSUE_FILTERS} sort="created" dir="desc" page={1} context={context} labelFor={(key) => key} refreshToken={0}
        onFilters={vi.fn()} onSort={vi.fn()} onPage={vi.fn()} onOpenIssue={vi.fn()} onOpenIssueAction={onOpenIssueAction} onChanged={vi.fn()} />,
    );
    return onOpenIssueAction;
  }

  it("gives each card Mark fixed and a menu with Propose deduction and Escalate; the status filters leave the row", async () => {
    setPhone(true);
    const onAction = renderIssues();
    const markFixed = await screen.findByRole("button", { name: "Mark fixed" });
    fireEvent.click(markFixed);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), "rectify");
    expect(screen.getByRole("button", { name: "Review false confirmation" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "More actions for linen" })[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Escalate" }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), "escalate");
    expect(severityFilter()).toHaveLength(0);
    expect(screen.getByRole("link", { name: /Export CSV/ })).toBeTruthy();
  });

  it("from 640px up keeps the same columns and the inline status filters", async () => {
    setPhone(false);
    renderIssues();
    await screen.findAllByText("Bed made with stained sheet");
    expect(screen.queryByRole("button", { name: "Mark fixed" })).toBeNull();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent?.trim()).filter(Boolean)).not.toContain("Actions");
    expect(severityFilter()).toHaveLength(1);
  });
});

describe("the shared filters", () => {
  it("sit behind one Filter button on a phone, with the tab's status filters in the same sheet", async () => {
    setPhone(true);
    const onChange = vi.fn();
    render(
      <SharedFilters
        filters={{ ...DEFAULT_ISSUE_FILTERS, openFixes: true }}
        options={{ cleaners: [], inspectors: [], properties: [], categories: [] }}
        optionsError={null}
        searchLabel="Search cleaner, property or job"
        onChange={onChange}
        phoneExtra={<button type="button">Severity</button>}
        phoneExtraActive={[{ key: "severity", label: "Severity: High", onRemove: vi.fn() }]}
      />,
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Has open fixes" }));
    expect(onChange).toHaveBeenCalledWith({ openFixes: false });
    expect(screen.getByRole("button", { name: "Remove filter Severity: High" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter quality" });
    expect(within(sheet).getByRole("searchbox", { name: "Search cleaner, property or job" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Severity" })).toBeTruthy();
  });

  it("render inline from 640px up", () => {
    setPhone(false);
    render(<SharedFilters filters={DEFAULT_ISSUE_FILTERS} options={null} optionsError={null} searchLabel="Search cleaner, property or job" onChange={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: "Search cleaner, property or job" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Has open fixes" })).toBeTruthy();
  });
});
