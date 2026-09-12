import { useState } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobsColumnsMenu } from "@/components/v2/admin/jobs/jobs-columns-menu";
import { JobsWorkspace } from "@/components/v2/admin/jobs/jobs-workspace";
import { EJobRow, EBoardCard } from "@/components/v2/admin/jobs/job-row";
import { useJobsWorkspaceState } from "@/components/v2/admin/jobs/use-jobs-workspace-state";
import { DEFAULT_JOBS_COLUMNS, DEFAULT_JOBS_STATE, jobsSnapshot } from "@/lib/jobs/workspace-state";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigate }), useSearchParams: () => new URLSearchParams(window.location.search) }));
const subsets = Array.from({ length: 8 }, (_, bits) => ({ client: Boolean(bits & 1), cleaner: Boolean(bits & 2), schedule: Boolean(bits & 4) }));
const props = { job: { id: "synthetic", property: { name: "Readable property with a long name", client: { name: "Client fixture" } },
  assignments: [{ user: { name: "Cleaner fixture" } }], scheduledDate: "2026-09-09T00:00:00Z", startTime: "09:00", status: "COMPLETED", fixedPrice: 120 },
  selected: false, onToggleSelect: vi.fn(), onQuickAssign: vi.fn(), onManage: vi.fn() };

beforeEach(() => { window.history.replaceState({ marker: true }, "", "/v2/admin/jobs"); vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Jobs optional list columns", () => {
  it.each(subsets)("keeps mandatory controls, property minimum and matching mobile/desktop details for %j", columns => {
    const { container } = render(<EJobRow {...props} columns={columns} />);
    expect(screen.getByText(props.job.property.name)).toBeVisible();
    expect(screen.getByText("Completed")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: `Select ${props.job.property.name}` })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open" })).toBeVisible();
    expect(screen.getByRole("button", { name: `Manage ${props.job.property.name}` })).toBeVisible();
    const row = screen.getByRole("link");
    const tracks = row.style.getPropertyValue("--jobs-row-columns");
    expect(tracks).toContain("18px minmax(14rem, 1fr)");
    expect(tracks).toContain("minmax(5rem, 8rem) 10rem");
    const mobile = container.querySelector(".e-job-row-summary");
    for (const key of ["client", "cleaner", "schedule"] as const) {
      expect(container.querySelectorAll(`.e-job-row-detail[data-job-column="${key}"]`)).toHaveLength(columns[key] ? 1 : 0);
      expect(mobile?.querySelectorAll(`[data-job-column="${key}"]`).length ?? 0).toBe(columns[key] ? 1 : 0);
    }
    expect(container.querySelector(".e-job-row-property")).toHaveClass("min-w-0");
    expect(screen.getAllByText("$120").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(props.onToggleSelect).toHaveBeenCalledWith("synthetic");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(navigate).toHaveBeenCalledWith("/v2/admin/jobs/synthetic");
  });
  it("leaves board content unchanged when list columns are hidden", () => {
    render(<EBoardCard {...props} columns={subsets[0]} />);
    expect(screen.getByText("Cleaner fixture")).toBeVisible();
    expect(screen.getByText("Client fixture")).toBeVisible();
    expect(screen.getByText(/09:00/)).toBeVisible();
  });
  it("supports keyboard checkbox toggles, show-all and Escape focus return", async () => {
    function MenuHarness() {
      const [columns, setColumns] = useState(DEFAULT_JOBS_COLUMNS);
      return <JobsColumnsMenu columns={columns} onChange={setColumns} />;
    }
    render(<MenuHarness />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "List columns" });
    trigger.focus(); await user.keyboard("[Enter]");
    const client = screen.getByRole("menuitemcheckbox", { name: "Client" });
    expect(client).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(3);
    await user.keyboard("[Space]");
    expect(client).toHaveAttribute("aria-checked", "false");
    await user.keyboard("[ArrowDown][Space]");
    expect(screen.getByRole("menuitemcheckbox", { name: "Cleaner" })).toHaveAttribute("aria-checked", "false");
    await user.keyboard("[Escape]");
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard("[Enter]");
    await user.click(screen.getByRole("menuitem", { name: "Show all columns" }));
    await user.click(trigger);
    for (const item of screen.getAllByRole("menuitemcheckbox")) expect(item).toHaveAttribute("aria-checked", "true");
  });
});

describe("Jobs column URL restoration", () => {
  it("blocks saving malformed URL columns until explicit correction, then sends the exact selection", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?columns=unknown");
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/me/jobs-views") {
        if (options?.method === "PATCH") {
          writes.push(JSON.parse(options.body as string));
          return { ok: false, status: 400, json: async () => ({ error: "Test rejected write" }) };
        }
        return { ok: true, status: 200, json: async () => ({ context: "test-context", data: { version: 1, revision: 0, views: [], defaultId: null } }) };
      }
      if (url.startsWith("/api/jobs?")) return { ok: true, json: async () => ({ jobs: [], pagination: { page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false } }) };
      return { ok: true, json: async () => [] };
    }));
    render(<JobsWorkspace viewsContext="test-context" />);
    await waitFor(() => expect(screen.queryByText("Saving or loading views...")).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid columns");
    expect(screen.getByRole("button", { name: "Save as new view" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Search jobs" }), { target: { value: "Keep filter" } });
    expect(new URLSearchParams(window.location.search).get("columns")).toBe("unknown");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "List columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Client" }));
    await user.keyboard("[Escape]");
    expect(screen.queryByText(/Invalid columns/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save as new view" }));
    await user.type(screen.getByLabelText("View name"), "Columns view");
    await user.click(screen.getByRole("button", { name: "Save view" }));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ revision: 0, change: { action: "create", snapshot: {
      search: "Keep filter", columns: { client: false, cleaner: true, schedule: true },
    } } });
  });
  it("applies a saved column subset to the menu and clears an invalid URL without auto-applying its default", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?columns=bad");
    const id = "11111111-1111-4111-8111-111111111111";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () =>
      url === "/api/me/jobs-views" ? { context: "test-context", data: { version: 1, revision: 1, defaultId: id,
        views: [{ id, name: "Mandatory only", snapshot: jobsSnapshot({ ...DEFAULT_JOBS_STATE, columns: subsets[0] }) }] } }
        : url.startsWith("/api/jobs?") ? { jobs: [], pagination: { page: 1, limit: 50, totalCount: 0, totalPages: 1, hasMore: false } } : [],
    })));
    render(<JobsWorkspace viewsContext="test-context" />);
    const select = screen.getByRole("combobox", { name: "Personal saved view" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(new URLSearchParams(window.location.search).get("columns")).toBe("bad");
    fireEvent.change(select, { target: { value: id } });
    expect(new URLSearchParams(window.location.search).get("columns")).toBe("none");
    expect(screen.queryByText(/Invalid columns/)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "List columns" }));
    for (const item of screen.getAllByRole("menuitemcheckbox")) expect(item).toHaveAttribute("aria-checked", "false");
  });
  it("preserves page on column-only edits, restores none on remount/Back, and resets all", () => {
    window.history.replaceState({ marker: true }, "", "/v2/admin/jobs?page=4&other=keep#anchor");
    const first = renderHook(useJobsWorkspaceState);
    act(() => first.result.current.update({ columns: subsets[0] }));
    expect(first.result.current.state.page).toBe(4);
    expect(window.location.search).toContain("columns=none");
    const savedUrl = window.location.href;
    first.unmount();
    const next = renderHook(useJobsWorkspaceState);
    expect(next.result.current.state.columns).toEqual(subsets[0]);
    act(() => next.result.current.update({ ...DEFAULT_JOBS_STATE }));
    expect(next.result.current.state.columns).toEqual(DEFAULT_JOBS_COLUMNS);
    expect(window.location.search).toContain("jobsState=1");
    expect(window.location.search).not.toContain("columns=");
    expect(window.location.hash).toBe("#anchor");
    act(() => { window.history.replaceState({ marker: true }, "", savedUrl); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(next.result.current.state).toMatchObject({ columns: subsets[0], page: 4 });
    expect(window.location.search).toContain("other=keep");
  });
  it("preserves invalid URL columns during unrelated edits until explicitly corrected", () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?columns=unknown&columns=client");
    const hook = renderHook(useJobsWorkspaceState);
    expect(hook.result.current.columnsError).toBe(true);
    act(() => hook.result.current.update({ search: "typed" }));
    expect(new URLSearchParams(window.location.search).getAll("columns")).toEqual(["unknown", "client"]);
    expect(hook.result.current.columnsError).toBe(true);
    act(() => hook.result.current.update({ columns: DEFAULT_JOBS_COLUMNS }));
    expect(hook.result.current.columnsError).toBe(false);
    expect(new URLSearchParams(window.location.search).has("columns")).toBe(false);
  });
  it("column edits beat a late personal default; applying a saved snapshot resets page", () => {
    const hook = renderHook(useJobsWorkspaceState);
    act(() => hook.result.current.update({ columns: subsets[0], page: 4 }));
    act(() => { expect(hook.result.current.applyDefault(jobsSnapshot(DEFAULT_JOBS_STATE))).toBe(false); });
    expect(hook.result.current.state.columns).toEqual(subsets[0]);
    act(() => hook.result.current.update({ ...jobsSnapshot({ ...DEFAULT_JOBS_STATE, columns: subsets[3] }), page: 1 }));
    expect(hook.result.current.state).toMatchObject({ columns: subsets[3], page: 1 });
  });
});
