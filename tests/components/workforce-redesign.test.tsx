/**
 * Workforce redesign components (boards "Workforce" and "M-Workforce"):
 * the compliance action list with the review panel and "Next to review",
 * the phone review page with "Verify and go to next", the team leave list on
 * a phone, the performance window retry (never zeros), and the coaching
 * outcome control that only administrators may set to Suspended/Terminated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const m = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: m.refresh, replace: vi.fn() }),
  usePathname: () => "/v2/admin/workforce/compliance",
  useSearchParams: () => new URLSearchParams(),
}));

import { ComplianceBoard, ComplianceDialogsProvider, ComplianceHeaderActions } from "@/components/v2/admin/workforce/compliance-board";
import { TeamLeaveView } from "@/components/v2/admin/workforce/team-leave-view";
import { PerformanceView } from "@/components/v2/admin/workforce/performance-view";
import { CoachingWorkspace } from "@/components/v2/admin/workforce/coaching-workspace";
import { buildComplianceRows, complianceFigures } from "@/lib/workforce/compliance-rows";
import { leaveWindow } from "@/lib/workforce/team-leave-model";
import type { ComplianceLibraryDoc } from "@/lib/workforce/compliance-load";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

const docs: ComplianceLibraryDoc[] = [
  { id: "d-tom", title: "Public liability insurance", category: "INSURANCE", status: "PENDING", fileName: "tom-pl.pdf", url: "https://x/tom.pdf", notes: null, expiresAt: null, createdAt: "2026-11-10T07:42:00Z", requiresSignature: true, user: { id: "tom", name: "Tom Nguyen", role: "CLEANER", image: null }, uploadedByName: "Tom Nguyen", verifiedByName: null },
  { id: "d-grace", title: "Right to work", category: "WORKING_RIGHTS", status: "PENDING", fileName: "grace.pdf", url: "https://x/grace.pdf", notes: null, expiresAt: null, createdAt: "2026-11-11T07:42:00Z", requiresSignature: false, user: { id: "grace", name: "Grace Kim", role: "CLEANER", image: null }, uploadedByName: "Grace Kim", verifiedByName: null },
  { id: "d-liam", title: "Police check", category: "POLICE_CHECK", status: "VERIFIED", fileName: "liam.pdf", url: "https://x/liam.pdf", notes: null, expiresAt: "2026-11-02T00:00:00Z", createdAt: "2023-11-02T00:00:00Z", requiresSignature: false, user: { id: "liam", name: "Liam O'Brien", role: "CLEANER", image: null }, uploadedByName: null, verifiedByName: "Hannah Lee" },
];

function boardProps(readOnlyReason: string | null = null) {
  const rows = buildComplianceRows({
    documents: docs.map((doc) => ({ id: doc.id, title: doc.title, category: doc.category, status: doc.status, expiresAt: doc.expiresAt, createdAt: doc.createdAt, requiresSignature: doc.requiresSignature, userId: doc.user.id, userName: doc.user.name, verifiedByName: doc.verifiedByName })),
    requests: [],
    profiles: [{ userId: "aiko", userName: "Aiko Tanaka", visaExpiry: "2027-01-09T00:00:00Z", driverLicenseExpiry: null, vehicleRegoExpiry: null }],
  }, new Date("2026-11-14T01:00:00Z"));
  return { rows, figures: complianceFigures(rows), documents: docs, requests: [], staff: [{ id: "tom", name: "Tom Nguyen", role: "CLEANER" }], timeZone: "Australia/Sydney", todayKey: "2026-11-14", readOnlyReason };
}

function renderBoard(readOnlyReason: string | null = null) {
  return render(
    <ComplianceDialogsProvider>
      <ComplianceHeaderActions disabledReason={readOnlyReason} />
      <ComplianceBoard {...boardProps(readOnlyReason)} />
    </ComplianceDialogsProvider>,
  );
}

beforeEach(() => {
  m.fetch.mockReset();
  m.refresh.mockReset();
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Compliance on desktop", () => {
  beforeEach(() => setPhone(false));

  it("shows the urgent list with profile dates, figures and every old action", () => {
    renderBoard();
    const table = screen.getByRole("region", { name: "Documents needing action" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Liam O'Brien");
    expect(rows[0]).toHaveTextContent("Expired 12 d");
    expect(within(table).getByText("profile date")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Request renewal…" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Send reminder…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload for someone/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Request a document/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /All documents on file/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("reviews one document beside the list, needs a reason to reject, and moves to the next", async () => {
    m.fetch.mockResolvedValue(ok({ ok: true }));
    renderBoard();
    fireEvent.click(within(screen.getByRole("region", { name: "Documents needing action" })).getAllByRole("button", { name: "Review" })[0]);
    const panel = screen.getByRole("region", { name: "Public liability insurance" });
    fireEvent.click(within(panel).getByRole("radio", { name: "Reject" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Reject document" }));
    expect(within(panel).getByRole("alert")).toHaveTextContent("Say why it is rejected");
    expect(m.fetch).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Next to review ›" }));
    expect(screen.getByRole("region", { name: "Right to work" })).toBeInTheDocument();
  });

  it("refuses sending and reviewing while testing as someone else", () => {
    renderBoard("Stop testing as Chloe Martin to send this.");
    expect(screen.getByRole("button", { name: /Upload for someone/ })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "Documents needing action" })).getByRole("button", { name: "Send reminder…" })).toBeDisabled();
  });
});

describe("Compliance on a phone", () => {
  beforeEach(() => setPhone(true));

  it("shows cards and a review page with one docked button, Verify and go to next", async () => {
    m.fetch.mockResolvedValue(ok({ ok: true }));
    renderBoard();
    expect(screen.queryByRole("region", { name: "Documents needing action" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);
    expect(screen.getByText(/1 of 2 to review/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify and go to next" }));
    await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(m.fetch.mock.calls[0][1].body))).toMatchObject({ action: "REVIEW_DOCUMENT", documentId: "d-tom", status: "VERIFIED" });
    await waitFor(() => expect(screen.getByText(/2 of 2 to review/)).toBeInTheDocument());
  });
});

describe("Team leave", () => {
  const people = [{ id: "s", name: "Sofia Alvarez", role: "CLEANER", leave: [{ id: "l", userId: "s", kind: "LEAVE" as const, startDate: "2026-11-19", endDate: "2026-11-23", note: "Family in Perth", jobsNeedingCover: 4 }], usuallyUnavailable: [] },
    { id: "d", name: "Dev Patel", role: "CLEANER", leave: [], usuallyUnavailable: [{ dayOfWeek: 0, startTime: "00:00", endTime: "23:59", note: null }] }];

  it("lists leave by day on a phone with the jobs-need-cover link and the pattern shown only", () => {
    setPhone(true);
    render(<TeamLeaveView people={people} window={leaveWindow("2026-11-14", 14)} view="next14" previousHref="#" nextHref="#" todayKey="2026-11-14" canRecord />);
    expect(screen.getByRole("link", { name: "4 jobs need cover ›" })).toHaveAttribute("href", "/v2/admin/jobs?cleanerId=s&dateFrom=2026-11-19&dateTo=2026-11-23");
    expect(screen.getByText(/Family in Perth/)).toBeInTheDocument();
    expect(screen.getByText(/Usually unavailable · shown only/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Next 14 days" })).toHaveAttribute("aria-checked", "true");
  });

  it("draws the fortnight grid on desktop", () => {
    setPhone(false);
    render(<TeamLeaveView people={people} window={leaveWindow("2026-11-16", 14)} view="fortnight" previousHref="#" nextHref="#" todayKey="2026-11-16" canRecord />);
    const grid = screen.getByRole("region", { name: "Team leave by day" });
    expect(within(grid).getByRole("link", { name: "4 jobs need cover" })).toBeInTheDocument();
    expect(within(grid).getAllByText("Usual").length).toBe(2);
  });
});

describe("Performance windows", () => {
  it("shows a timed-out window as not worked out and retries that window only", async () => {
    setPhone(false);
    const metrics = { userId: "u", windowDays: 30, windowStart: "2026-10-15T00:00:00Z", quality: { score: 94, sampleSize: 41 }, reliability: { onTimePercent: 97, sampleSize: 31 }, punctuality: { avgMinutesLate: -4, sampleSize: 31 }, attendance: { completedJobs: 31, assignedJobs: 31, percent: 100 }, documentation: { fullyDocumentedPercent: 100, sampleSize: 31 }, customerSatisfaction: { avgRating: 4.9, sampleSize: 14 }, responseRate: { acceptedPercent: 96, sampleSize: 31 }, disputeRate: { disputes: 0, totalJobs: 31, percent: 0 }, noShowRate: { noShows: 0, scheduled: 31, percent: 0 }, documentCompliance: { current: 5, expired: 1, percent: 83 }, trainingCompletion: { completed: 5, assigned: 5, percent: 100 }, reworkRate: { reworks: 0, majorReworks: 0, minutesLost: 0, amountLost: 0, totalJobs: 31, percent: 0 }, currentStreak: 3, last5Avg: 94, last10Avg: 93 };
    m.fetch.mockResolvedValue(ok({ status: "ready", windowDays: 365, metrics: { ...metrics, windowDays: 365 } }));
    render(<PerformanceView userId="u" initial={[{ status: "ready", windowDays: 30, metrics }, { status: "ready", windowDays: 90, metrics: { ...metrics, windowDays: 90 } }, { status: "timed_out", windowDays: 365 }]} />);
    expect(screen.getByText("94%", { selector: "p" })).toBeInTheDocument();
    expect(screen.getAllByText(/Good/, { selector: "p" }).length).toBe(4);
    const failed = screen.getByRole("region", { name: "Last 365 days" });
    expect(within(failed).getByRole("alert")).toHaveTextContent("This window took too long to work out.");
    expect(within(failed).getAllByText("– not worked out")).toHaveLength(3);
    expect(within(failed).queryByText("0%")).toBeNull();
    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Last 365 days" })).getByText("Last 365 days · 31 jobs")).toBeInTheDocument());
    expect(m.fetch).toHaveBeenCalledWith("/api/admin/workforce/performance/u?window=365", expect.anything());
  });

  it("switches windows with a segmented control on a phone", () => {
    setPhone(true);
    render(<PerformanceView userId="u" initial={[{ status: "timed_out", windowDays: 30 }, { status: "failed", windowDays: 90 }, { status: "timed_out", windowDays: 365 }]} />);
    expect(screen.getByRole("radio", { name: "30 days" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    expect(screen.getByRole("region", { name: "Last 90 days" })).toHaveTextContent("This window could not be worked out.");
    expect(screen.queryByRole("region", { name: "Last 365 days" })).toBeNull();
  });
});

describe("Coaching outcome", () => {
  function mockCoaching(canRecordDismissal: boolean) {
    m.fetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/admin/users")) return ok({ users: [{ id: "liam", name: "Liam O'Brien" }] });
      return ok({ records: [{ id: "r", type: "WARNING", status: "OPEN", reason: "Oven glass missed on 3 cleans", notes: null, issueIds: [], patternKey: null, retrainingRequired: false, reviewDate: null, acknowledgedAt: null, outcome: "NONE", createdAt: "2026-11-09T05:10:00Z", cleaner: { id: "liam", name: "Liam O'Brien" }, createdBy: { id: "a", name: "Hannah Lee" } }], statusCounts: { OPEN: 1, RESOLVED: 14 }, viewer: { canRecordDismissal } });
    });
  }

  it("operations managers cannot pick Suspended or Terminated; the chips show server totals", async () => {
    setPhone(false);
    mockCoaching(false);
    render(<CoachingWorkspace />);
    expect(await screen.findByRole("button", { name: /Open\s*1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Resolved\s*14/ })).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole("button", { name: /Liam O'Brien/ }))[0]);
    expect(screen.getAllByText(/^Not acknowledged/).length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: "Suspended" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Terminated" })).toBeDisabled();
    expect(screen.getByText("Only an administrator can record Suspended or Terminated.")).toBeInTheDocument();
  });

  it("an administrator choosing Suspended is asked for their own PIN before anything is saved", async () => {
    setPhone(false);
    mockCoaching(true);
    render(<CoachingWorkspace />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Liam O'Brien/ }))[0]);
    fireEvent.click(screen.getByRole("radio", { name: "Suspended" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("dialog", { name: /Record Suspended for Liam O'Brien/ })).toBeInTheDocument();
    expect(m.fetch.mock.calls.some((call) => call[1]?.method === "PATCH")).toBe(false);
  });
});
