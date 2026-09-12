import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobsWorkspace } from "@/components/v2/admin/jobs/jobs-workspace";
import { readJobsState } from "@/components/v2/admin/jobs/use-jobs-workspace-state";
import { DEFAULT_JOBS_STATE, jobsSnapshot } from "@/lib/jobs/workspace-state";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/admin/jobs/job-row", () => ({
  EJobRow: ({ job }: any) => <div>List {job.property.name}</div>,
  EBoardCard: ({ job }: any) => <div>Board {job.property.name}</div>,
  ECheck: () => null, assignmentNames: () => [], scheduledLabel: () => "", statusLabel: (s: string) => s,
}));

type Pending = { url: string; resolve: (response: unknown) => void; reject: (error: Error) => void };
let pending: Pending[];
function respond(index: number, name: string, page = 1) {
  pending[index].resolve({ ok: true, json: async () => ({
    jobs: [{ id: name, property: { name }, status: "UNASSIGNED", assignments: [], scheduledDate: "2026-09-09T00:00:00Z" }],
    pagination: { page, limit: 50, totalCount: 200, totalPages: 4, hasMore: page < 4 },
  }) });
}
beforeEach(() => {
  pending = [];
  window.history.replaceState({}, "", "/v2/admin/jobs");
  vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/jobs?")
    ? new Promise((resolve, reject) => pending.push({ url, resolve, reject }))
    : Promise.resolve({ ok: true, json: async () => [] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Jobs workspace URL integration", () => {
  it("applies a named view to accessible selected controls and the server query", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => url === "/api/me/jobs-views"
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ context: "test-context", data: {
        version: 1, revision: 1, defaultId: null, views: [{ id: "11111111-1111-4111-8111-111111111111", name: "Today active",
          snapshot: jobsSnapshot({ ...DEFAULT_JOBS_STATE, dateScope: "today", statusChip: "active", search: "Harbour", sort: "latest", view: "board", density: "comfortable" }) }],
      } }) }) : originalFetch(url, options)));
    render(<JobsWorkspace viewsContext="test-context" />);
    const select = screen.getByRole("combobox", { name: "Personal saved view" });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: "11111111-1111-4111-8111-111111111111" } });
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Board view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("textbox", { name: "Search jobs" })).toHaveValue("Harbour");
    expect(screen.getByRole("combobox", { name: "Jobs density" })).toHaveValue("comfortable");
    expect(screen.getByRole("combobox", { name: "Sort jobs" })).toHaveValue("latest");
    await waitFor(() => expect(pending[pending.length - 1].url).toContain("search=Harbour"));
    expect(pending[pending.length - 1].url).toContain("statusGroup=active");
    expect(pending[pending.length - 1].url).not.toContain("density");
  });
  it("accepts exactly the sort values exposed by the select", () => {
    render(<JobsWorkspace />);
    const select = screen.getByRole("combobox", { name: "Sort jobs" }) as HTMLSelectElement;
    const values = Array.from(select.options, option => option.value);
    expect(values).toEqual(["soonest", "latest", "created", "property", "status"]);
    for (const sort of values) expect(readJobsState(new URLSearchParams({ sort })).sort).toBe(sort);
    expect(readJobsState(new URLSearchParams({ sort: "scheduled_desc" })).sort).toBe("soonest");
  });

  it("shows an error for 503 without stale rows or counts and retries the same filtered page", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?sort=latest&page=3");
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Previous", 3));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), { target: { value: "created" } });
    await act(async () => pending[1].resolve({ ok: false, status: 503 }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load jobs");
    expect(screen.queryByText("Nothing on the books")).not.toBeInTheDocument();
    expect(screen.queryByText("List Previous")).not.toBeInTheDocument();
    expect(screen.queryByText("200")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    const url = window.location.href;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Preparing the ledger…")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(pending[2].url).toBe(pending[1].url);
    expect(window.location.href).toBe(url);
    await act(async () => respond(2, "Recovered"));
    expect(screen.getByText("List Recovered")).toBeVisible();
    expect(screen.getByText("200")).toBeVisible();
  });

  const validPagination = { page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false };
  it.each([
    null, {}, { jobs: [] }, { jobs: {}, pagination: validPagination },
    { jobs: [null], pagination: validPagination },
    { jobs: [{}], pagination: validPagination },
    { jobs: [{ id: "x", status: "UNASSIGNED", assignments: "bad" }], pagination: validPagination },
    ...[
      { page: 0 }, { page: 2 }, { page: 1.5 }, { limit: 10 }, { totalCount: -1 },
      { totalCount: "0" }, { totalPages: 0 }, { totalPages: 2 }, { hasMore: "false" }, { hasMore: true },
    ].map(patch => ({ jobs: [], pagination: { ...validPagination, ...patch } })),
  ])("rejects malformed 200 payload %# and accepts a valid empty response on retry", async payload => {
    render(<JobsWorkspace />);
    await act(async () => pending[0].resolve({ ok: true, json: async () => payload }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Nothing on the books")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(pending[1].url).toBe(pending[0].url);
    await act(async () => pending[1].resolve({ ok: true, json: async () => ({ jobs: [], pagination: validPagination }) }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing on the books")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
  });

  it("ignores a stale failure after a newer query succeeds", async () => {
    render(<JobsWorkspace />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), { target: { value: "latest" } });
    await act(async () => respond(1, "Current"));
    await act(async () => pending[0].resolve({ ok: false, status: 503 }));
    expect(screen.getByText("List Current")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("fetches the restored page with server refinements and preserves state on reload", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?statusChip=UNASSIGNED&sort=latest&dateFrom=2026-09-01&dateTo=2026-09-30&cleanerId=unassigned&page=3&view=board&search=Harbour&invoiced=no");
    const first = render(<JobsWorkspace />);
    expect(pending).toHaveLength(1);
    const query = new URL(pending[0].url, window.location.origin).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ page: "3", sort: "latest", status: "UNASSIGNED", dateFrom: "2026-09-01", dateTo: "2026-09-30", cleanerId: "unassigned", search: "Harbour", invoiced: "no" });
    await act(async () => respond(0, "Harbour", 3));
    expect(screen.getByText("Board Harbour")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByText("List Harbour")).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("page")).toBe("3");
    expect(pending).toHaveLength(1);
    first.unmount();
    render(<JobsWorkspace />);
    expect(pending).toHaveLength(2);
    expect(pending[1].url).toBe(pending[0].url);
    await act(async () => respond(1, "Harbour", 3));
    expect(screen.getByText("List Harbour")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(new URLSearchParams(window.location.search).get("page")).toBe("4");
    await act(async () => respond(2, "Harbour", 4));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const cleared = new URLSearchParams(window.location.search);
    expect(cleared.has("dateFrom")).toBe(false);
    expect(cleared.has("cleanerId")).toBe(false);
    expect(cleared.has("page")).toBe(false);
    expect(cleared.get("search")).toBe("Harbour");
    await act(async () => respond(3, "Harbour"));
  });

  it("ignores older responses and their loading completion when filters change", async () => {
    render(<JobsWorkspace />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), { target: { value: "latest" } });
    expect(pending).toHaveLength(2);
    await act(async () => respond(0, "Stale"));
    expect(screen.queryByText("List Stale")).not.toBeInTheDocument();
    expect(screen.getByText("Preparing the ledger…")).toBeVisible();
    await act(async () => respond(1, "Current"));
    expect(screen.getByText("List Current")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), { target: { value: "property" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), { target: { value: "created" } });
    await act(async () => respond(3, "Newest"));
    await act(async () => respond(2, "Older"));
    expect(screen.getByText("List Newest")).toBeVisible();
    expect(screen.queryByText("List Older")).not.toBeInTheDocument();
  });

  it("handles a failed request and can load a subsequent filter", async () => {
    render(<JobsWorkspace />);
    await act(async () => pending[0].reject(new Error("offline")));
    expect(screen.queryByText("Preparing the ledger…")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), { target: { value: "latest" } });
    await act(async () => respond(1, "Recovered"));
    await waitFor(() => expect(screen.getByText("List Recovered")).toBeVisible());
  });

  it("debounces typed search, resets page before fetching and trusts server invoice matches", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/v2/admin/jobs?page=3");
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Previous", 3));
    const search = screen.getByPlaceholderText("Search property, client, cleaner, job number…");
    expect(search).toHaveAttribute("maxlength", "200");
    fireEvent.change(search, { target: { value: "Ha" } });
    await act(async () => vi.advanceTimersByTime(200));
    fireEvent.change(search, { target: { value: "Harbour" } });
    expect(new URLSearchParams(window.location.search).has("page")).toBe(false);
    expect(screen.queryByText("List Previous")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(299));
    expect(pending).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(pending).toHaveLength(2);
    expect(Object.fromEntries(new URL(pending[1].url, window.location.origin).searchParams))
      .toMatchObject({ search: "Harbour", page: "1" });
    await act(async () => respond(1, "Harbour"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => respond(2, "Harbour", 2));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by invoice status" }), { target: { value: "yes" } });
    expect(Object.fromEntries(new URL(pending[3].url, window.location.origin).searchParams))
      .toMatchObject({ search: "Harbour", invoiced: "yes", page: "1" });
    // The invoice relation is intentionally absent from the list response.
    await act(async () => respond(3, "Harbour"));
    expect(screen.getByText("List Harbour")).toBeVisible();
  });

  it("exports with the same search and invoice filters independently of the current page", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?page=3&search=Harbour&invoiced=yes&clientId=client-1");
    render(<JobsWorkspace />);
    await act(async () => respond(0, "Harbour", 3));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const list = new URL(pending[0].url, window.location.origin).searchParams;
    const exported = new URL(pending[1].url, window.location.origin).searchParams;
    list.set("page", "1");
    list.set("limit", "5000");
    expect(Object.fromEntries(exported)).toEqual(Object.fromEntries(list));
    await act(async () => pending[1].resolve({ ok: true, json: async () => ({ jobs: [] }) }));
  });
});
