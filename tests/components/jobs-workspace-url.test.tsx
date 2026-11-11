import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobsWorkspace } from "@/components/v2/admin/jobs/jobs-workspace";
import { readJobsState } from "@/components/v2/admin/jobs/use-jobs-workspace-state";
import { DEFAULT_JOBS_STATE, jobsSnapshot } from "@/lib/jobs/workspace-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

type Pending = { url: string; resolve: (response: unknown) => void; reject: (error: Error) => void };
let pending: Pending[];
const counts = { today: 14, "needs-cleaner": 3, week: 61, "awaiting-qa": 5, "not-invoiced": 22, all: 128 };
function respond(index: number, name: string, page = 1, extra: Record<string, unknown> = {}) {
  pending[index].resolve({ ok: true, json: async () => ({
    jobs: [{ id: name, property: { name }, status: "UNASSIGNED", assignments: [], scheduledDate: "2026-09-09T00:00:00Z",
      guestIn: { checkinAt: null, stayStartDate: null, sameDay: false }, charge: { amount: null, source: "MISSING", missing: true } }],
    pagination: { page, limit: 50, totalCount: 200, totalPages: 4, hasMore: page < 4 },
    ...extra,
  }) });
}
const params = (index: number) => Object.fromEntries(new URL(pending[index].url, window.location.origin).searchParams);
const row = (name: string) => screen.queryByRole("button", { name: `Preview ${name}` });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  pending = [];
  window.history.replaceState({}, "", "/v2/admin/jobs");
  vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/jobs?")
    ? new Promise((resolve, reject) => pending.push({ url, resolve, reject }))
    : Promise.resolve({ ok: true, json: async () => [] })));
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Jobs workspace URL integration", () => {
  it("shows real view totals on built-in tabs and applies a tab's filters", async () => {
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Harbour", 1, { counts }));
    expect(screen.getByRole("button", { name: "Needs a cleaner 3" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("200 jobs match · updated just now")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Needs a cleaner 3" }));
    expect(readJobsState(new URLSearchParams(window.location.search))).toMatchObject({ statusChip: "UNASSIGNED,OFFERED", dateScope: "all" });
    expect(params(1)).toMatchObject({ status: "UNASSIGNED,OFFERED", counts: "1", extras: "1" });
    expect(screen.getByRole("button", { name: "Needs a cleaner 3" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Not invoiced 22" }));
    expect(params(2)).toMatchObject({ status: "COMPLETED", invoiced: "no" });
  });

  it("applies a personal saved view from its tab to the visible controls and the server query", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => url === "/api/me/jobs-views"
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ context: "test-context", data: {
        version: 1, revision: 1, defaultId: null, views: [{ id: "11111111-1111-4111-8111-111111111111", name: "Today active",
          snapshot: jobsSnapshot({ ...DEFAULT_JOBS_STATE, dateScope: "today", statusChip: "active", search: "Harbour", sort: "latest", view: "list", density: "comfortable" }) }],
      } }) }) : originalFetch(url, options)));
    render(<JobsWorkspace viewsContext="test-context" />);
    const tab = await screen.findByRole("button", { name: "Today active" });
    fireEvent.click(tab);
    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Date: Today/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Status: Active/ })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Search jobs" })).toHaveValue("Harbour");
    await waitFor(() => expect(pending[pending.length - 1].url).toContain("search=Harbour"));
    expect(params(pending.length - 1)).toMatchObject({ statusGroup: "active", sort: "when", dir: "desc" });
    expect(pending[pending.length - 1].url).not.toContain("density");
  });

  it("keeps every filter visible as a chip and clears search, status and date together", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?search=Harbour&statusChip=active&dateScope=today");
    render(<JobsWorkspace />);
    expect(screen.getByRole("textbox", { name: "Search jobs" })).toBeVisible();
    for (const name of [/^Date: Today/, /^Status: Active/, /^Client/, /^Cleaner/, /^Job type/, /^Invoice/]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(readJobsState(new URLSearchParams(window.location.search))).toMatchObject({ search: "", statusChip: "all", dateScope: "all" });
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
  });

  it("filters on any combination of the eleven statuses", async () => {
    render(<JobsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    const group = screen.getByRole("group", { name: "Status filter" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(11);
    fireEvent.click(within(group).getByRole("checkbox", { name: "Waiting approval" }));
    fireEvent.click(within(group).getByRole("checkbox", { name: "Unassigned" }));
    expect(readJobsState(new URLSearchParams(window.location.search)).statusChip).toBe("UNASSIGNED,WAITING_CONTINUATION_APPROVAL");
    expect(params(pending.length - 1).status).toBe("UNASSIGNED,WAITING_CONTINUATION_APPROVAL");
  });

  it("sorts from the column headers and sends the list-query sort and direction", async () => {
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Harbour"));
    expect(screen.getByRole("columnheader", { name: /When/ })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: /^Property/ }));
    expect(readJobsState(new URLSearchParams(window.location.search)).sort).toBe("property");
    expect(params(1)).toMatchObject({ sort: "property", dir: "asc" });
    await act(async () => respond(1, "Harbour"));
    fireEvent.click(screen.getByRole("button", { name: /^Property/ }));
    expect(params(2)).toMatchObject({ sort: "property", dir: "desc" });
    await act(async () => respond(2, "Harbour"));
    expect(screen.getByText("No rate")).toBeVisible();
    // Wave A (on purpose): Cleaner, Guest in and Charge sort on the server over
    // the whole filtered set (tests/lib/jobs-computed-sort.test.ts).
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Charge/ })).getByRole("button"));
    expect(params(3)).toMatchObject({ sort: "charge", dir: "asc" });
    expect(readJobsState(new URLSearchParams(window.location.search)).sort).toBe("charge");
    await act(async () => respond(3, "Harbour"));
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Cleaner/ })).getByRole("button"));
    expect(params(4)).toMatchObject({ sort: "cleaner", dir: "asc" });
    await act(async () => respond(4, "Harbour"));
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Guest in/ })).getByRole("button"));
    expect(params(5)).toMatchObject({ sort: "guestIn", dir: "asc" });
    expect(readJobsState(new URLSearchParams({ sort: "scheduled_desc" })).sort).toBe("soonest");
  });

  it("refreshes in place on focus, retains rows on failure and recovers", async () => {
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Original"));
    fireEvent(window, new Event("focus"));
    expect(row("Original")).toBeVisible();
    fireEvent(window, new Event("focus"));
    expect(pending).toHaveLength(2);
    await act(async () => pending[1].resolve({ ok: false }));
    expect(row("Original")).toBeVisible();
    expect(screen.getByText(/Live refresh unavailable/)).toBeVisible();
    fireEvent(window, new Event("focus"));
    await act(async () => respond(2, "Updated"));
    expect(row("Updated")).toBeVisible();
    expect(screen.queryByText(/Live refresh unavailable/)).not.toBeInTheDocument();
  });

  it("loads and applies team defaults while view options stay closed", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/me/jobs-views") return Promise.resolve({ ok: true, status: 200, json: async () => ({ context: "test-context", data: { version: 1, revision: 0, defaultId: null, views: [] } }) });
      if (url === "/api/admin/jobs-team-default") return Promise.resolve({ ok: true, status: 200, json: async () => ({ context: "test-context", canPublish: true, data: { version: 1, revision: 1, updatedBy: "admin", updatedAt: "2026-10-09T00:00:00.000Z", snapshot: jobsSnapshot({ ...DEFAULT_JOBS_STATE, density: "comfortable", view: "board" }) } }) });
      return originalFetch(url, options);
    }));
    render(<JobsWorkspace viewsContext="test-context" teamDefaultsEnabled />);
    await waitFor(() => expect(readJobsState(new URLSearchParams(window.location.search))).toMatchObject({ density: "comfortable", view: "board" }));
    expect(screen.getByRole("button", { name: "Publish current view", hidden: true })).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("button", { name: "Publish current view" })).toBeEnabled();
  });

  it("opens view options from Columns and resets appearance without losing filters", () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?search=Harbour&view=board&density=compact&sort=latest");
    render(<JobsWorkspace />);
    const columns = screen.getByRole("button", { name: "Columns" });
    expect(columns).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(columns);
    expect(screen.getByRole("combobox", { name: "Jobs density" })).toHaveValue("compact");
    fireEvent.click(screen.getByRole("button", { name: "Reset appearance" }));
    expect(readJobsState(new URLSearchParams(window.location.search))).toMatchObject({ search: "Harbour", view: "list", density: "default", sort: "soonest" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(columns).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("combobox", { name: "Jobs density", hidden: true })).not.toBeVisible();
  });

  it("shows an error for 503 without stale rows or counts and retries the same filtered page", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?sort=latest&page=3");
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Previous", 3));
    fireEvent.click(screen.getByRole("button", { name: /^Type/ }));
    await act(async () => pending[1].resolve({ ok: false, status: 503 }));
    expect(screen.getByRole("alert")).toHaveTextContent("Jobs are temporarily unavailable");
    expect(screen.queryByText("Nothing on the books")).not.toBeInTheDocument();
    expect(row("Previous")).toBeNull();
    expect(screen.queryByText(/jobs match/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    const url = window.location.href;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Loading…")).toBeVisible();
    expect(pending[2].url).toBe(pending[1].url);
    expect(window.location.href).toBe(url);
    await act(async () => respond(2, "Recovered"));
    expect(row("Recovered")).toBeVisible();
    expect(screen.getByText(/200 jobs match/)).toBeVisible();
  });

  const validPagination = { page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false };
  it.each([
    null, {}, { jobs: [] }, { jobs: {}, pagination: validPagination },
    { jobs: [null], pagination: validPagination },
    { jobs: [{}], pagination: validPagination },
    { jobs: [{ id: "x", status: "UNASSIGNED", assignments: "bad" }], pagination: validPagination },
    { jobs: [], pagination: validPagination, counts: { today: -1 } },
    ...[
      { page: 0 }, { page: 2 }, { page: 1.5 }, { limit: 10 }, { totalCount: -1 },
      { totalCount: "0" }, { totalPages: 0 }, { totalPages: 2 }, { hasMore: "false" }, { hasMore: true },
    ].map(patch => ({ jobs: [], pagination: { ...validPagination, ...patch } })),
  ])("rejects malformed 200 payload %# and accepts a valid empty response on retry", async payload => {
    render(<JobsWorkspace />);
    await act(async () => pending[0].resolve({ ok: true, json: async () => payload }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Nothing on the books")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 jobs match/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(pending[1].url).toBe(pending[0].url);
    await act(async () => pending[1].resolve({ ok: true, json: async () => ({ jobs: [], pagination: validPagination }) }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing on the books")).toBeVisible();
    expect(screen.getByText(/0 jobs match/)).toBeVisible();
  });

  it("ignores a stale failure after a newer query succeeds", async () => {
    render(<JobsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await act(async () => respond(1, "Current"));
    await act(async () => pending[0].resolve({ ok: false, status: 503 }));
    expect(row("Current")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("fetches the restored page with server refinements and preserves state on reload", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?statusChip=OFFERED,UNASSIGNED&sort=latest&dateFrom=2026-09-01&dateTo=2026-09-30&cleanerId=unassigned&page=3&search=Harbour&invoiced=no");
    const first = render(<JobsWorkspace />);
    expect(pending).toHaveLength(1);
    expect(params(0)).toMatchObject({ page: "3", sort: "when", dir: "desc", status: "UNASSIGNED,OFFERED", dateFrom: "2026-09-01", dateTo: "2026-09-30", cleanerId: "unassigned", search: "Harbour", invoiced: "no" });
    await act(async () => respond(0, "Harbour", 3));
    expect(row("Harbour")).toBeVisible();
    first.unmount();
    render(<JobsWorkspace />);
    expect(pending).toHaveLength(2);
    expect(pending[1].url).toBe(pending[0].url);
    await act(async () => respond(1, "Harbour", 3));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(new URLSearchParams(window.location.search).get("page")).toBe("4");
    await act(async () => respond(2, "Harbour", 4));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const cleared = new URLSearchParams(window.location.search);
    for (const key of ["dateFrom", "cleanerId", "page", "search", "statusChip"]) expect(cleared.has(key)).toBe(false);
    await waitFor(() => expect(pending).toHaveLength(4));
    await act(async () => respond(3, "Harbour"));
  });

  it("ignores older responses and their loading completion when filters change", async () => {
    render(<JobsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(pending).toHaveLength(2);
    await act(async () => respond(0, "Stale"));
    expect(row("Stale")).toBeNull();
    expect(screen.getByText("Loading…")).toBeVisible();
    await act(async () => respond(1, "Current"));
    expect(row("Current")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    fireEvent.click(screen.getByRole("button", { name: "Awaiting QA" }));
    await act(async () => respond(3, "Newest"));
    await act(async () => respond(2, "Older"));
    expect(row("Newest")).toBeVisible();
    expect(row("Older")).toBeNull();
  });

  it("handles a failed request and can load a subsequent filter", async () => {
    render(<JobsWorkspace />);
    await act(async () => pending[0].reject(new Error("offline")));
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await act(async () => respond(1, "Recovered"));
    await waitFor(() => expect(row("Recovered")).toBeVisible());
  });

  it("debounces typed search, resets page before fetching and trusts server invoice matches", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/v2/admin/jobs?page=3");
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Previous", 3));
    const search = screen.getByRole("textbox", { name: "Search jobs" });
    expect(search).toHaveAttribute("maxlength", "200");
    fireEvent.change(search, { target: { value: "Ha" } });
    await act(async () => vi.advanceTimersByTime(200));
    fireEvent.change(search, { target: { value: "Harbour" } });
    expect(new URLSearchParams(window.location.search).has("page")).toBe(false);
    expect(row("Previous")).toBeNull();
    await act(async () => vi.advanceTimersByTime(299));
    expect(pending).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(pending).toHaveLength(2);
    expect(params(1)).toMatchObject({ search: "Harbour", page: "1" });
    await act(async () => respond(1, "Harbour"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => respond(2, "Harbour", 2));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by invoice status", hidden: true }), { target: { value: "yes" } });
    expect(params(3)).toMatchObject({ search: "Harbour", invoiced: "yes", page: "1" });
    await act(async () => respond(3, "Harbour"));
    expect(row("Harbour")).toBeVisible();
  });

  it("exports with the same filters and sort independently of the current page", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?page=3&search=Harbour&invoiced=yes&clientId=client-1");
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Harbour", 3));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const list = new URL(pending[0].url, window.location.origin).searchParams;
    const exported = new URL(pending[1].url, window.location.origin).searchParams;
    list.set("page", "1");
    list.set("limit", "5000");
    list.delete("counts");
    list.delete("extras");
    expect(Object.fromEntries(exported)).toEqual(Object.fromEntries(list));
    await act(async () => pending[1].resolve({ ok: true, json: async () => ({ jobs: [] }) }));
  });

  it("exports only the selected jobs from the bulk bar", async () => {
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Harbour"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Harbour/ }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("1 job selected")).toBeVisible();
    // Wave A added Reschedule (preview from the Calendar's move check, then the reschedule service).
    for (const name of ["Assign cleaner", "Change status", "Reschedule", "Send reminder", "Assign QA", "Export selected", "Clear"]) {
      expect(within(bar).getByRole("button", { name: new RegExp(name) })).toBeVisible();
    }
    fireEvent.click(within(bar).getByRole("button", { name: "Export selected" }));
    expect(params(1)).toMatchObject({ ids: "Harbour", page: "1", limit: "5000" });
    expect(screen.getByText("Exports the 1 selected job in the current sort order.")).toBeVisible();
    await act(async () => pending[1].resolve({ ok: true, json: async () => ({ jobs: [] }) }));
  });

  it("opens the peek panel in the URL and closes it with Escape, returning focus", async () => {
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Harbour"));
    const preview = screen.getByRole("button", { name: "Preview Harbour" });
    preview.focus();
    fireEvent.click(preview);
    expect(new URLSearchParams(window.location.search).get("open")).toBe("Harbour");
    const panel = screen.getByRole("complementary", { name: "Job preview" });
    expect(within(panel).getByRole("link", { name: "Open full job" })).toHaveAttribute("href", "/v2/admin/jobs/Harbour");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Job preview" })).toBeNull();
    expect(new URLSearchParams(window.location.search).has("open")).toBe(false);
    await waitFor(() => expect(preview).toHaveFocus());
  });
});

it.each([[401, "Your session has expired"], [403, "does not have permission"], [500, "(500)"]])("identifies Jobs HTTP %s without exposing raw server internals", async (status, message) => {
  render(<JobsWorkspace />);
  await act(async () => pending[0].resolve({ ok: false, status, json: async () => ({ error: "private database details" }) }));
  expect(screen.getByRole("alert")).toHaveTextContent(String(message));
  expect(screen.queryByText("private database details")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

it("renders one heading for the page and keeps the old Manage destination reachable", async () => {
  render(<JobsWorkspace showPageHeader />);
  await act(async () => respond(0, "Harbour"));
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "New job" })).toHaveAttribute("href", "/v2/admin/jobs/new");
  // Wave A: "Import or bulk create" is its own entry: bulk create (deep link) and CSV import.
  fireEvent.click(screen.getByRole("button", { name: "Import or bulk create" }));
  expect(await screen.findByRole("link", { name: "Open bulk create" })).toHaveAttribute("href", "/v2/admin/jobs/new#bulk-create");
  expect(screen.getByRole("button", { name: "Download template" })).toBeVisible();
});
