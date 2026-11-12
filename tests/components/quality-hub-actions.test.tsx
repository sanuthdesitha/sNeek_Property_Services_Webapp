import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CleanerExpanded } from "@/components/v2/admin/quality/hub/cleaner-expanded";
import { CoachingDialog } from "@/components/v2/admin/quality/hub/coaching-dialog";
import { BonusDialog } from "@/components/v2/admin/quality/hub/bonus-dialog";
import { QualityStatCards } from "@/components/v2/admin/quality/hub/stat-cards";
import { ReviewTab } from "@/components/v2/admin/quality/hub/review-tab";
import { LaundryTeamSection } from "@/components/v2/admin/quality/hub/laundry-team-section";
import type { CleanerRow, HubContext, SummaryPayload } from "@/components/v2/admin/quality/hub/hub-types";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const context: HubContext = { canManage: true, inspectorView: false, timeZone: "Australia/Sydney", falseConfirmationDeduction: 10 };

const ROW: CleanerRow = {
  cleanerId: "c1",
  name: "Marco Rossi",
  active: true,
  cleans: 24,
  reviewed: 20,
  avgScore: 81,
  ratingMix: { EXCELLENT: 6, PASS: 10, NEEDS_IMPROVEMENT: 2, FAILED: 0, MANAGEMENT_REVIEW: 1, unrated: 1 },
  trend: [],
  issues: { total: 10, bySeverity: { MINOR: 5, MAJOR: 3, CRITICAL: 2 } },
  topCategory: { category: "linen", label: "Linen and beds", count: 4 },
  categories: [
    { category: "linen", label: "Linen and beds", count: 4 },
    { category: "kitchen", label: "Kitchen", count: 3 },
  ],
  openFixes: 2,
  falseConfirmations: { suspected: 1, confirmed: 0 },
  streak: { currentStreak: 0, last5Avg: 80, last10Avg: 82, sample: 10 },
  pendingBonuses: [{ id: "bonus1", title: "Streak bonus — 5 consecutive", amount: 20, source: "STREAK_5", origin: "automatic", createdAt: "2026-11-10T00:00:00Z" }],
  openCoaching: 0,
  coachingSuggestion: { category: "linen", label: "Linen and beds", count: 4, windowDays: 30, patternKey: "cleaner:c1:linen", issueIds: ["i1", "i9"] },
  action: "start-coaching",
};

function issue(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    category: "linen",
    severity: "CRITICAL",
    description: "Bed made with stained sheet",
    rectificationStatus: "PENDING",
    rectificationMinutes: null,
    rectificationCost: null,
    rectificationBeforeKeys: null,
    rectificationAfterKeys: null,
    falseConfirmation: "NONE",
    guestReadyImpact: false,
    cleanerMarkedComplete: false,
    qaPhotoKeys: [{ key: "a" }, { key: "b" }],
    escalatedAt: null,
    createdAt: new Date(Date.now() - 52 * 3_600_000).toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "job1",
    propertyId: "p1",
    cleanerId: "c1",
    job: { id: "job1", jobNumber: "J1", scheduledDate: null, propertyName: "Manly Loft", propertySuburb: null },
    property: null,
    cleaner: { id: "c1", name: "Marco Rossi" },
    raisedBy: { id: "q1", name: "QA Dana" },
    rectifiedBy: null,
    review: null,
    payAdjustment: null,
    ...extra,
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("expanded cleaner row", () => {
  it("lists that cleaner's open issues and wires every action to the existing flows", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ ok: true });
      return Response.json({ rows: [issue("i1"), issue("i2", { falseConfirmation: "SUSPECTED", severity: "MAJOR", description: "Ticked oven cleaned" })], total: 7, page: 1, pageSize: 5, pageCount: 2, sort: "created", dir: "desc" });
    });
    const onOpenIssue = vi.fn();
    const onChanged = vi.fn();
    render(
      <CleanerExpanded row={ROW} apiQuery="period=30d&propertyId=p1" context={context} labelFor={(k) => k} issuesHref="/v2/admin/quality?tab=issues&cleanerId=c1" refreshToken={0} onOpenIssue={onOpenIssue} onChanged={onChanged} />,
    );

    await screen.findByText("Bed made with stained sheet");
    const readUrl = new URL(String(fetchMock.mock.calls[0][0]), "http://x");
    expect(readUrl.pathname).toBe("/api/admin/quality/issues");
    expect(Object.fromEntries(readUrl.searchParams)).toMatchObject({ period: "30d", propertyId: "p1", cleanerId: "c1", openFixes: "1" });
    expect(screen.getByText("Marco's open issues")).toBeTruthy();
    expect(screen.getByText("Fix pending 52 h")).toBeTruthy();
    expect(screen.getByText("Showing 2 of 7 open.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open all 10 in Issues" }).getAttribute("href")).toBe("/v2/admin/quality?tab=issues&cleanerId=c1");

    fireEvent.click(screen.getByRole("button", { name: "Mark fixed" }));
    expect(onOpenIssue).toHaveBeenLastCalledWith(expect.objectContaining({ action: "rectify", issue: expect.objectContaining({ id: "i1" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Propose deduction" }));
    expect(onOpenIssue).toHaveBeenLastCalledWith(expect.objectContaining({ action: "deduction" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirm, −10" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/admin/qa/issues/i2");
    expect(JSON.parse(String(patch[1].body))).toEqual({ action: "falseConfirmation", decision: "CONFIRMED" });
  });

  it("shows no actions to a read-only viewer", async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [issue("i1")], total: 1, page: 1, pageSize: 5, pageCount: 1, sort: "created", dir: "desc" }));
    render(<CleanerExpanded row={ROW} apiQuery="" context={{ ...context, canManage: false }} labelFor={(k) => k} issuesHref="#" refreshToken={0} onOpenIssue={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("Bed made with stained sheet");
    expect(screen.queryByRole("button", { name: "Mark fixed" })).toBeNull();
  });

  it("shows the cleaner's rating mix (Excellent / Pass / Needs work / Failed / Mgmt review), leaving out empty bands", async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [], total: 0, page: 1, pageSize: 5, pageCount: 0, sort: "created", dir: "desc" }));
    render(<CleanerExpanded row={ROW} apiQuery="" context={context} labelFor={(k) => k} issuesHref="#" refreshToken={0} onOpenIssue={vi.fn()} onChanged={vi.fn()} />);
    const mix = screen.getByRole("list", { name: "Rating mix" });
    expect(Array.from(mix.querySelectorAll("li")).map((item) => item.textContent)).toEqual(["Excellent 6", "Pass 10", "Needs work 2", "Mgmt review 1", "No rating 1"]);
  });

  it("says there are no reviewed cleans instead of printing zeros", async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [], total: 0, page: 1, pageSize: 5, pageCount: 0, sort: "created", dir: "desc" }));
    const empty = { ...ROW, ratingMix: { EXCELLENT: 0, PASS: 0, NEEDS_IMPROVEMENT: 0, FAILED: 0, MANAGEMENT_REVIEW: 0, unrated: 0 } };
    render(<CleanerExpanded row={empty} apiQuery="" context={context} labelFor={(k) => k} issuesHref="#" refreshToken={0} onOpenIssue={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText("No reviewed cleans in this period.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Rating mix" })).toBeNull();
  });
});

describe("row actions use the existing coaching and bonus endpoints", () => {
  it("Start coaching posts to the coaching route with the pattern behind it", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "rec1" }, { status: 201 }));
    const onCreated = vi.fn();
    render(<CoachingDialog row={ROW} onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "Create coaching record" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/accountability/coaching");
    expect(JSON.parse(String(init.body))).toMatchObject({
      cleanerId: "c1",
      type: "COACHING",
      reason: "Linen and beds flagged 4 times in the last 30 days.",
      issueIds: ["i1", "i9"],
      patternKey: "cleaner:c1:linen",
    });
  });

  it("keeps the coaching draft when saving fails", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Cleaner not found." }, { status: 400 }));
    render(<CoachingDialog row={ROW} onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "Talk on Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "Create coaching record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cleaner not found.");
    expect((screen.getByLabelText("Notes (optional)") as HTMLTextAreaElement).value).toBe("Talk on Friday");
  });

  it("Review bonus decides the nightly job's proposal through the pay-adjustment endpoint", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "bonus1", status: "APPROVED" }));
    const onDecided = vi.fn();
    render(<BonusDialog row={ROW} timeZone="Australia/Sydney" onClose={vi.fn()} onDecided={onDecided} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pay-adjustments/bonus1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "APPROVED" }) }));
    expect(screen.getByText("Approved")).toBeTruthy();
  });
});

describe("stat cards never invent a figure", () => {
  const base: SummaryPayload = {
    cleansReviewed: { reviewed: 0, cleans: 0 },
    averageScore: { value: null, sample: 0, previous: null, previousSample: 0, delta: null },
    issuesRaised: { total: 0, critical: 0, major: 0, minor: 0 },
    fixesOpen: { open: 0, over48h: 0 },
    fixCost: { amount: null, minutes: null, fixesWithCost: 0 },
    managementReview: { count: 0 },
    tabs: { reviewQueue: 0, inspections: 0, quickScore: 0, issues: 0, coaching: 0 },
  };

  it("shows a dash and the reason when there is no data", () => {
    render(<QualityStatCards summary={base} loading={false} error={null} />);
    expect(screen.getByText("Not enough data")).toBeTruthy();
    expect(screen.getByText("No fix cost recorded")).toBeTruthy();
    expect(screen.getAllByText("–")).toHaveLength(2);
    expect(screen.queryByText(/on last period/)).toBeNull();
  });

  it("states the change only when the previous period had reviews", () => {
    const withScore = { ...base, averageScore: { value: 88, sample: 20, previous: null, previousSample: 0, delta: null } };
    const { rerender } = render(<QualityStatCards summary={withScore} loading={false} error={null} />);
    expect(screen.getByText("No earlier data to compare")).toBeTruthy();
    rerender(<QualityStatCards summary={{ ...withScore, averageScore: { value: 88, sample: 20, previous: 86, previousSample: 9, delta: 2 } }} loading={false} error={null} />);
    expect(screen.getByText("+2 on last period")).toBeTruthy();
  });

  it("restores the Mgmt review queue count, linked to the queue that lists those reviews", () => {
    render(<QualityStatCards summary={{ ...base, managementReview: { count: 3 } }} loading={false} error={null} />);
    const card = screen.getByText("Mgmt review queue").closest("div")!;
    expect(card.parentElement).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: "Open the queue" })).toHaveAttribute("href", "/v2/admin/approvals?queue=managementReviews");
  });

  it("separates loading from failure", () => {
    const { rerender } = render(<QualityStatCards summary={null} loading error={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading figures");
    rerender(<QualityStatCards summary={null} loading={false} error="Database unavailable" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
  });
});

describe("review queue counters (restored from the old Quality page)", () => {
  const props = { filterQuery: "", sort: "", dir: "" as const, page: 1, quickScoreTotal: 0, timeZone: "Australia/Sydney", refreshToken: 0, onSort: vi.fn(), onPage: vi.fn(), onChanged: vi.fn() };

  it("shows Awaiting QA, In progress and Completed today from the inspections read", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/admin/quality/inspections")) {
        return Response.json({ rows: [], total: 0, page: 1, pageSize: 20, pageCount: 0, sort: "due", dir: "asc", counters: { awaiting: 4, inProgress: 1, completedToday: 6, timeZone: "Australia/Sydney" } });
      }
      return Response.json({ rows: [], total: 0 });
    });
    render(<ReviewTab {...props} />);
    const counts = await screen.findByLabelText("Inspection queue counts");
    expect(counts).toHaveTextContent("Awaiting QA4");
    expect(counts).toHaveTextContent("In progress1");
    expect(counts).toHaveTextContent("Completed today6");
  });

  it("shows no counters (never zeros) when the read carries none", async () => {
    fetchMock.mockImplementation(async () => Response.json({ rows: [], total: 0, page: 1, pageSize: 20, pageCount: 0, sort: "due", dir: "asc" }));
    render(<ReviewTab {...props} />);
    await screen.findByText("No inspections waiting");
    expect(screen.queryByLabelText("Inspection queue counts")).toBeNull();
  });
});

describe("laundry team and suppliers on the Quality hub (quality pack)", () => {
  const metrics = {
    team: [{ userId: "l1", name: "Lee Laundry", pickups: 3, drops: 2, onTimeDropPct: 100, photoCompliancePct: null, avgCycleDays: 1.5, stuckCount: 1 }],
    teamTotals: { stuckUnattributed: 0 },
    suppliers: [],
  };

  it("reads nothing until opened, then reads the quality-pack route and keeps the period", async () => {
    fetchMock.mockImplementation(async () => Response.json(metrics));
    render(<LaundryTeamSection laundryStatsLink={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Laundry team and suppliers" }));
    expect(await screen.findByText("Lee Laundry")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/quality/laundry-team-metrics?period=30d");
    expect(screen.getByText("Our laundry team")).toBeTruthy();
    // No laundry pack: no link to a page that would refuse them.
    expect(screen.queryByRole("link", { name: "Laundry statistics" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/admin/quality/laundry-team-metrics?period=7d"));
    fireEvent.click(screen.getByRole("button", { name: "Laundry team and suppliers" }));
    fireEvent.click(screen.getByRole("button", { name: "Laundry team and suppliers" }));
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  });

  it("separates a failed read from empty data, and links Laundry statistics when allowed", async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: "no" }, { status: 500 }));
    render(<LaundryTeamSection laundryStatsLink />);
    fireEvent.click(screen.getByRole("button", { name: "Laundry team and suppliers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Laundry team metrics could not be loaded.");
    expect(screen.getByRole("link", { name: "Laundry statistics" })).toHaveAttribute("href", "/v2/admin/laundry/stats#team-metrics");
  });
});
