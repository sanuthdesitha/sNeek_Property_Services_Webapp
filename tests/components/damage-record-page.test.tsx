import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Damage report record page (board "Damage report"): the outline while
 * loading (never "No items"), a refused report says so and links back to the
 * job, a blank estimate reads "Not estimated" and the total says what it
 * covers, release is tier A and carries the ticked transports, send back is
 * tier C with its modes and quick reasons, and phones dock the decision.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/v2/admin/damage/report1", useSearchParams: () => null }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { DamageRecordPage } from "@/components/v2/admin/damage/damage-record";

function phoneMedia(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("min-width") ? !phone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const report = {
  id: "report1", status: "UNDER_REVIEW", submittedAt: "2026-11-11T00:40:00.000Z", clientVisible: false, reviewedAt: null, reviewedByName: null,
  acknowledgedAt: null, acknowledgedName: null, voids: [], reportedByName: "Maria Santos", jobId: "job1", propertyId: "prop1", propertyName: "Bondi Beach House", highestSeverity: "MAJOR",
  items: [
    { id: "item1", area: "Kitchen", category: "Benchtop", severity: "MAJOR", description: "Burn mark about 8 cm across.", suspectedCause: "GUEST", estimatedCost: 350,
      photos: [{ id: "p1", url: "/flat.jpg", caption: null, section: "CLOSE_UP", annotated: true, originalUrl: "/original.jpg", markedUpUrl: "/flat.jpg" }],
      caseId: "case1", caseState: "OPEN", caseStatus: "OPEN", transitions: [], maintenance: [] },
    { id: "item3", area: "Bathroom 2", category: "Floor tile", severity: "MINOR", description: "Hairline crack.", suspectedCause: "UNKNOWN", estimatedCost: null,
      photos: [], caseId: "case3", caseState: "OPEN", caseStatus: "OPEN", transitions: [], maintenance: [] },
  ],
};
const context = {
  job: { id: "job1", jobNumber: "J-1051", jobType: "AIRBNB_TURNOVER", scheduledDate: "2026-11-10T01:00:00.000Z" },
  property: { id: "prop1", name: "Bondi Beach House" },
  client: { id: "client1", name: "Harbour View Stays" },
  verification: null, earlierReportsAtProperty: 0, firstSubmittedAt: "2026-11-10T01:48:00.000Z",
  estimate: { total: 350, estimatedItems: 1, itemCount: 2 }, history: [], lastRelease: null, caseOpenedAt: {},
};
const notice = { clientName: "Harbour View Stays", recipients: [{ id: "olivia", name: "Olivia Grant", hasEmail: true, hasPhone: false }], refusal: null, title: "A damage report for Bondi Beach House is ready", body: "Our cleaner recorded 2 items.", smsConfigured: true, switchedOff: [] };

let fetcher: ReturnType<typeof vi.fn>;
function routes(overrides: { record?: () => Response } = {}) {
  fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return json({ report });
    if (url.includes("view=release-notice")) return json({ notice });
    if (url.includes("view=client")) return json({ report: { ...report, items: report.items.map((item) => ({ ...item, estimatedCost: null })) }, audience: "CLIENT" });
    if (url.startsWith("/api/admin/damage/")) return overrides.record ? overrides.record() : json({ report, context });
    return json({});
  });
  vi.stubGlobal("fetch", fetcher);
}

beforeEach(() => phoneMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("loading and refusal", () => {
  it("shows the page outline while loading, never an empty claim", async () => {
    fetcher = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetcher);
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Loading the damage report");
    expect(screen.queryByText(/No items/)).toBeNull();
    expect(screen.getByRole("link", { name: "← Job J-1051" })).toHaveAttribute("href", "/v2/admin/jobs/job1");
  });

  it("says a report that cannot be opened is not available, and links back to the job", async () => {
    routes({ record: () => json({ error: "Not found" }, 404) });
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This damage report is not available to you.");
    expect(screen.getByRole("link", { name: "← Job J-1051" })).toBeInTheDocument();
  });
});

describe("the record", () => {
  it("has one heading, the estimate with its coverage, and a blank estimate as not estimated", async () => {
    routes();
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    expect(await screen.findByRole("heading", { level: 1, name: /Damage at Bondi Beach House/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("$350.00")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 items · 1 not estimated · internal")).toBeInTheDocument();
    const inputs = screen.getAllByLabelText("Repair estimate, AUD · internal");
    expect(inputs[0]).toHaveValue(350);
    expect(inputs[1]).toHaveValue(null);
    expect(inputs[1]).toHaveAttribute("placeholder", "Not estimated");
    expect(screen.getByText(/never counted as \$0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Close-up · marked up/ })).toBeInTheDocument();
  });

  it("releases on tier A with the ticked transports and a kept request key", async () => {
    routes();
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    await screen.findByText("A damage report for Bondi Beach House is ready");
    expect(screen.getByRole("checkbox", { name: "Portal inbox" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Email to Olivia Grant" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SMS" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SMS" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Release to client…" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Release to Harbour View Stays?" });
    expect(dialog).toHaveTextContent("an inbox message and an email");
    expect(within(dialog).queryByLabelText(/PIN/)).toBeNull();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Release" })); });
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(patch![1].body)).toEqual({ action: "REVIEW", release: true, notice: { transports: ["INBOX", "EMAIL"], idempotencyKey: expect.stringMatching(/^release:/) } });
  });

  it("closes without releasing as a named choice on tier A", async () => {
    routes();
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    await screen.findByText("A damage report for Bondi Beach House is ready");
    fireEvent.click(screen.getByRole("radio", { name: /Close without releasing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close without releasing…" }));
    const dialog = await screen.findByRole("dialog", { name: "Close without releasing?" });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Close without releasing" })); });
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(patch![1].body)).toEqual({ action: "REVIEW", release: false, close: true });
  });

  it("sends back on tier C with its two modes, quick reasons and the own PIN", async () => {
    routes();
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    await screen.findByText("A damage report for Bondi Beach House is ready");
    fireEvent.click(screen.getByRole("radio", { name: /Send back to the cleaner/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send back to the cleaner…" }));
    const dialog = await screen.findByRole("dialog", { name: "Send this report back to Maria?" });
    expect(within(dialog).getByRole("radio", { name: /Reopen for editing/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Clear and start again/ })).toBeInTheDocument();
    expect(within(dialog).getByText("Photos do not show the damage")).toBeInTheDocument();
    expect(within(dialog).getByText("Duplicate report")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send back" })).toBeDisabled();
  });

  it("previews the client's view from the client serializer", async () => {
    routes();
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    await screen.findByText("A damage report for Bondi Beach House is ready");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const dialog = await screen.findByRole("dialog", { name: /What the client will see/ });
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("view=client"))).toBe(true));
    await waitFor(() => expect(dialog).toHaveTextContent("Burn mark"));
    expect(dialog).not.toHaveTextContent("350");
    expect(within(dialog).queryByRole("button", { name: "Acknowledge" })).toBeNull();
  });
});

describe("phone", () => {
  it("docks the primary decision and keeps every action in a More sheet", async () => {
    phoneMedia(true);
    routes();
    render(<DamageRecordPage reportId="report1" timeZone="Australia/Sydney" jobId="job1" jobNumber="J-1051" />);
    const bar = await screen.findByRole("region", { name: "Damage report actions" });
    expect(within(bar).getByRole("button", { name: "Release to client…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /More: preview as the client/ }));
    const sheet = await screen.findByRole("dialog", { name: "Damage report" });
    for (const label of ["Preview as the client", "Close without releasing…", "Copy link", "Send back to the cleaner…"]) expect(within(sheet).getByText(label)).toBeInTheDocument();
  });
});
