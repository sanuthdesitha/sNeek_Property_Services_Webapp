import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobPeekPanel } from "@/components/v2/admin/jobs/job-peek-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

type Call = { url: string; signal: AbortSignal; resolve: (body: unknown, status?: number) => void };
let calls: Call[];
const summary = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id, jobNumber: `J-${id}`, status: "UNASSIGNED", jobType: "AIRBNB_TURNOVER", scheduledDate: "2026-11-12T00:00:00.000Z",
  startTime: "10:00", endTime: "14:00", dueTime: null, cleanSkipStatus: "NONE",
  property: { id: "p", name, suburb: "Bondi Beach" }, client: { id: "c", name: "Harbour View Stays" },
  departing: { name: "Priya Shah", phoneLabel: "+61 400 111 222", phoneHref: "+61400111222", checkoutAt: null },
  arriving: { name: null, checkinAt: "2026-11-12T04:00:00.000Z", guestCountLabel: "2 adults", sameDay: true },
  laundry: null, charge: { amount: null, source: "MISSING", missing: true }, assignments: [], qa: null, ...overrides,
});
const callsTo = (fragment: string) => calls.filter((call) => call.url.includes(fragment));

beforeEach(() => {
  calls = [];
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => new Promise((resolve) => {
    calls.push({ url, signal: options.signal as AbortSignal, resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }) });
  })));
});
afterEach(() => vi.unstubAllGlobals());

const props = { row: null, readOnly: false, onClose: vi.fn(), onChanged: vi.fn() };

describe("Jobs peek panel", () => {
  it("loads the summary when opened and each other tab only when chosen", async () => {
    render(<JobPeekPanel {...props} jobId="a" />);
    expect(callsTo("/peek")).toHaveLength(1);
    expect(screen.getByText("Loading this job…")).toBeVisible();
    await act(async () => callsTo("/peek")[0].resolve(summary("a", "The Bondi Studio")));
    const panel = screen.getByRole("complementary", { name: "Job preview" });
    expect(within(panel).getByRole("heading", { name: "The Bondi Studio" })).toBeVisible();
    expect(within(panel).getByText("Thu 12 Nov · 10:00 – 14:00 · Airbnb turnover · J-a")).toBeVisible();
    expect(within(panel).getByRole("link", { name: "+61 400 111 222" })).toHaveAttribute("href", "tel:+61400111222");
    expect(within(panel).getByText(/15:00 same day · 2 adults/)).toBeVisible();
    expect(within(panel).getAllByText("No rate").length).toBeGreaterThan(0);
    expect(within(panel).getByRole("link", { name: "Reschedule" })).toHaveAttribute("href", "/v2/admin/jobs/a?tab=schedule");
    expect(within(panel).getByRole("link", { name: "Message client" })).toHaveAttribute("href", "/v2/admin/jobs/a?tab=messages#chat");
    // Unassigned: suggestions load with the summary; money and activity do not.
    expect(callsTo("/cleaner-suggestions")).toHaveLength(1);
    expect(callsTo("/pay-summary")).toHaveLength(0);
    expect(callsTo("/timeline")).toHaveLength(0);
    fireEvent.click(within(panel).getByRole("button", { name: "Money" }));
    expect(callsTo("/pay-summary")).toHaveLength(1);
    await act(async () => callsTo("/pay-summary")[0].resolve({ jobId: "a", payees: [] }));
    expect(within(panel).getByText("No cleaner pay recorded yet.")).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: "Summary" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Money" }));
    expect(callsTo("/pay-summary")).toHaveLength(1);
    fireEvent.click(within(panel).getByRole("button", { name: "Activity" }));
    expect(callsTo("/timeline")).toHaveLength(1);
  });

  it("shows suggestions with reasons, and a clash as a disabled Clash button", async () => {
    render(<JobPeekPanel {...props} jobId="a" />);
    await act(async () => callsTo("/peek")[0].resolve(summary("a", "The Bondi Studio")));
    await act(async () => callsTo("/cleaner-suggestions")[0].resolve({ kind: "ok", jobId: "a", considered: 3, suggestions: [
      { cleanerId: "jane", name: "Jane C.", assignable: true, blocker: null, reasons: ["Free 09:00–15:00", "Cleaned here 12 times"] },
      { cleanerId: "marco", name: "Marco R.", assignable: false, blocker: { kind: "clash", reason: "Clashes with Manly Loft until 11:00" }, reasons: ["Clashes with Manly Loft until 11:00", "Cleaned here 3 times"] },
    ] }));
    expect(screen.getByText("Free 09:00–15:00 · Cleaned here 12 times")).toBeVisible();
    expect(screen.getByRole("button", { name: "Assign Jane C." })).toBeEnabled();
    const clash = screen.getByRole("button", { name: "Marco R.: Clashes with Manly Loft until 11:00" });
    expect(clash).toBeDisabled();
    expect(clash).toHaveTextContent("Clash");
  });

  it("cancels stale loads when the selected job changes", async () => {
    const view = render(<JobPeekPanel {...props} jobId="a" />);
    await act(async () => callsTo("/peek")[0].resolve(summary("a", "Job A", { assignments: [{ userId: "u", name: "Ana", isPrimary: true, responseStatus: "ACCEPTED" }] })));
    fireEvent.click(screen.getByRole("button", { name: "Money" }));
    const staleMoney = callsTo("/pay-summary")[0];
    view.rerender(<JobPeekPanel {...props} jobId="b" />);
    expect(staleMoney.signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Summary" })).toHaveAttribute("aria-pressed", "true");
    const bSummary = callsTo("/peek")[1];
    expect(bSummary.url).toContain("/api/admin/jobs/b/peek");
    // A late answer for job A must not fill job B's panel.
    await act(async () => staleMoney.resolve({ jobId: "a", payees: [{ cleanerId: "u", cleanerName: "Stale Ana", assigned: true, approvedTotal: 99, pendingDelta: 0, basePay: { rateMissing: false, hours: 1, rate: 99, basis: "ALLOCATED" } }] }));
    await act(async () => bSummary.resolve(summary("b", "Job B")));
    expect(screen.getByRole("heading", { name: "Job B" })).toBeVisible();
    expect(screen.queryByText("Stale Ana")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Money" }));
    expect(callsTo("/pay-summary")).toHaveLength(2);
    expect(callsTo("/pay-summary")[1].url).toContain("/jobs/b/");
  });

  it("states a failed section and retries it", async () => {
    render(<JobPeekPanel {...props} jobId="a" />);
    await act(async () => callsTo("/peek")[0].resolve({ error: "nope" }, 503));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this section (503).");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(callsTo("/peek")).toHaveLength(2);
  });
});
