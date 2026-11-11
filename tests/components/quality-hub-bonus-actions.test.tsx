import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CleanersTab } from "@/components/v2/admin/quality/hub/cleaners-tab";
import { ProposeBonusDialog } from "@/components/v2/admin/quality/hub/propose-bonus-dialog";
import { SeverityCountPills, StreakCell } from "@/components/v2/admin/quality/hub/cleaners-cells";
import { QualityStatCards } from "@/components/v2/admin/quality/hub/stat-cards";
import { cleanerRowActions } from "@/components/v2/admin/quality/hub/cleaner-row-actions";
import type { CleanerRow, HubContext } from "@/components/v2/admin/quality/hub/hub-types";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const context: HubContext = { canManage: true, inspectorView: false, timeZone: "Australia/Sydney", falseConfirmationDeduction: 10, canDecideBonus: true, canProposeBonus: true };

const AUTO_BONUS = { id: "bonus1", title: "Streak bonus — 5 consecutive", amount: 20, source: "STREAK_5", origin: "automatic" as const, createdAt: "2026-11-10T00:00:00Z" };
const MANUAL_BONUS = { id: "bonus2", title: "Quality bonus", amount: 30, source: "", origin: "manual" as const, createdAt: "2026-11-09T00:00:00Z" };

function row(extra: Partial<CleanerRow> = {}): CleanerRow {
  return {
    cleanerId: "c1",
    name: "Jane Cleaner",
    active: true,
    cleans: 31,
    reviewed: 28,
    avgScore: 94,
    trend: [],
    issues: { total: 2, bySeverity: { MINOR: 2, MAJOR: 0, CRITICAL: 0 } },
    topCategory: null,
    categories: [],
    openFixes: 0,
    falseConfirmations: { suspected: 0, confirmed: 0 },
    streak: { currentStreak: 12, last5Avg: 98, last10Avg: 97, sample: 10 },
    pendingBonuses: [],
    openCoaching: 0,
    coachingSuggestion: null,
    action: null,
    ...extra,
  };
}

const ALL = { canCoach: true, canDecideBonus: true, canProposeBonus: true };
const COACHING = { coachingSuggestion: { category: "linen", label: "Linen", count: 4, windowDays: 30, patternKey: "k", issueIds: ["i1"] }, action: "start-coaching" as const };

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("one primary action per row, every applicable action reachable", () => {
  it("offers Propose bonus when nothing is pending and no coaching is due", () => {
    expect(cleanerRowActions(row(), ALL)).toEqual({ primary: "propose-bonus", more: [] });
  });

  it("Review bonus is primary when a bonus waits; proposing another stays in the menu", () => {
    expect(cleanerRowActions(row({ pendingBonuses: [AUTO_BONUS], action: "review-bonus" }), ALL)).toEqual({ primary: "review-bonus", more: ["propose-bonus"] });
  });

  it("coaching stays primary; the bonus actions move to the menu", () => {
    expect(cleanerRowActions(row({ ...COACHING }), ALL)).toEqual({ primary: "start-coaching", more: ["propose-bonus"] });
    expect(cleanerRowActions(row({ ...COACHING, pendingBonuses: [AUTO_BONUS] }), ALL)).toEqual({ primary: "start-coaching", more: ["review-bonus", "propose-bonus"] });
  });

  it("offers only what the viewer's endpoints accept, and never proposes for an inactive cleaner", () => {
    expect(cleanerRowActions(row({ ...COACHING }), { ...ALL, canProposeBonus: false })).toEqual({ primary: "start-coaching", more: [] });
    expect(cleanerRowActions(row({ pendingBonuses: [AUTO_BONUS] }), { ...ALL, canDecideBonus: false })).toEqual({ primary: "propose-bonus", more: [] });
    expect(cleanerRowActions(row({ active: false }), ALL)).toEqual({ primary: null, more: [] });
    expect(cleanerRowActions(row(), { canCoach: false, canDecideBonus: false, canProposeBonus: false })).toEqual({ primary: null, more: [] });
  });

  it("renders Start coaching as the button and Propose bonus in the row's more menu", async () => {
    fetchMock.mockResolvedValue(Response.json({ rows: [row({ ...COACHING })], issueTotal: 2, sort: "score", dir: "desc", period: { key: "30d", fromKey: "2026-10-13", toKey: "2026-11-11", days: 30 } }));
    render(
      <CleanersTab apiQuery="period=30d" sort="" dir="" context={context} labelFor={(k) => k} refreshToken={0} hrefForTab={() => "#"} onSort={vi.fn()} onOpenIssue={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: "Start coaching" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Propose bonus" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Jane Cleaner" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Propose bonus" }));
    const dialog = await screen.findByRole("dialog", { name: "Propose bonus · Jane Cleaner" });
    expect(within(dialog).getByText(/Last 30 days: 31 cleans, 28 reviewed, average score 94, current streak 12\./)).toBeTruthy();
  });
});

describe("the bonus-due badge stays tied to the automatic rule", () => {
  it("shows bonus due for an automatic proposal, not for a manual one", () => {
    const { rerender } = render(<StreakCell row={row({ pendingBonuses: [AUTO_BONUS] })} />);
    expect(screen.getByText("12 clean · bonus due")).toBeTruthy();
    rerender(<StreakCell row={row({ pendingBonuses: [MANUAL_BONUS] })} />);
    expect(screen.queryByText(/bonus due/)).toBeNull();
    expect(screen.getByText("12 clean")).toBeTruthy();
  });
});

function renderDialog(target: CleanerRow, extra: Partial<React.ComponentProps<typeof ProposeBonusDialog>> = {}) {
  const props = { onClose: vi.fn(), onProposed: vi.fn(), onReview: vi.fn() };
  render(<ProposeBonusDialog row={target} apiQuery="period=custom&from=2026-10-01&to=2026-10-31&propertyId=p1" periodText="1 Oct – 31 Oct" timeZone="Australia/Sydney" canReview {...props} {...extra} />);
  return props;
}

function fill(amount: string, reason: string) {
  fireEvent.change(screen.getByLabelText("Amount (AUD)"), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: reason } });
}

describe("Propose bonus dialog", () => {
  it("states the bounds, requires a reason and refuses an out-of-bounds amount without sending", () => {
    renderDialog(row());
    expect(screen.getByText("From $5 to $200.")).toBeTruthy();
    fill("250", "Great month");
    fireEvent.click(screen.getByRole("button", { name: "Propose bonus" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A quality bonus is from $5 to $200.");
    fill("50", "  ");
    fireEvent.click(screen.getByRole("button", { name: "Propose bonus" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A reason is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the proposal with the hub period and a request key, and keeps the entry and key for a retry after failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Database unavailable" }, { status: 500 }));
    const props = renderDialog(row());
    fill("50", "Two client compliments");
    fireEvent.click(screen.getByRole("button", { name: "Propose bonus" }));
    expect(await screen.findByText("Database unavailable Your entry is kept.")).toBeTruthy();
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("Two client compliments");
    const first = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/quality/bonus-proposals");
    expect(first).toMatchObject({ cleanerId: "c1", amount: 50, reason: "Two client compliments", period: "custom", from: "2026-10-01", to: "2026-10-31" });
    expect(first).not.toHaveProperty("propertyId");
    expect(first.idempotencyKey).toMatch(/^quality-bonus-/);

    fetchMock.mockResolvedValueOnce(Response.json({ id: "adj-1", duplicate: false, approvalsHref: "/v2/admin/approvals" }, { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(props.onProposed).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).idempotencyKey).toBe(first.idempotencyKey);
    expect(screen.getByRole("status")).toHaveTextContent("Bonus proposed. It waits for approval.");
    expect(screen.getByRole("link", { name: "Open Approvals" }).getAttribute("href")).toBe("/v2/admin/approvals");
  });

  it("warns about a pending bonus with a link to review it, and needs an explicit tick to propose another", async () => {
    const props = renderDialog(row({ pendingBonuses: [AUTO_BONUS] }));
    expect(screen.getByText("A bonus is already waiting for a decision for Jane Cleaner.")).toBeTruthy();
    expect(screen.getByText(/Streak bonus — 5 consecutive · \$20\.00 · proposed automatically/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review it" }));
    expect(props.onReview).toHaveBeenCalled();

    fill("40", "Covered two extra cleans");
    fireEvent.click(screen.getByRole("button", { name: "Propose bonus" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Propose another bonus anyway"));
    fetchMock.mockResolvedValueOnce(Response.json({ id: "adj-2", duplicate: false, approvalsHref: "/v2/admin/approvals" }, { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "Propose bonus" }));
    await waitFor(() => expect(props.onProposed).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).acknowledgePending).toBe(true);
  });

  it("shows a pending bonus the server found that the row did not show yet", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "A bonus is already waiting for a decision for this cleaner.", pending: [{ id: "m1", title: "Quality bonus", amount: 30, origin: "manual", createdAt: "2026-11-09T00:00:00Z" }] }, { status: 409 }),
    );
    renderDialog(row());
    fill("40", "Covered two extra cleans");
    fireEvent.click(screen.getByRole("button", { name: "Propose bonus" }));
    expect(await screen.findByText("A bonus is already waiting for a decision for Jane Cleaner.")).toBeTruthy();
    expect(screen.getByText(/Quality bonus · \$30\.00 · proposed by hand/)).toBeTruthy();
    expect((screen.getByLabelText("Amount (AUD)") as HTMLInputElement).value).toBe("40");
  });
});

describe("severity reads Low / Medium / High on the hub", () => {
  it("count pills and the Issues raised card use the shared labels", () => {
    render(<SeverityCountPills counts={{ MINOR: 5, MAJOR: 3, CRITICAL: 2 }} />);
    expect(screen.getByText("5 low")).toBeTruthy();
    expect(screen.getByText("3 med")).toBeTruthy();
    expect(screen.getByText("2 high")).toBeTruthy();
    render(
      <QualityStatCards
        summary={{
          cleansReviewed: { reviewed: 212, cleans: 240 },
          averageScore: { value: 88, sample: 212, previous: 86, previousSample: 200, delta: 2 },
          issuesRaised: { total: 37, critical: 4, major: 10, minor: 23 },
          fixesOpen: { open: 6, over48h: 2 },
          fixCost: { amount: 410, minutes: 660, fixesWithCost: 6 },
          tabs: { reviewQueue: 5, inspections: 0, quickScore: 0, issues: 37, coaching: 3 },
        }}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("4 high")).toBeTruthy();
  });
});
