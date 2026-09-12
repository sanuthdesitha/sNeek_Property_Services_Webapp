import { StrictMode } from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobsWorkspaceState, DEFAULT_JOBS_STATE } from "@/components/v2/admin/jobs/use-jobs-workspace-state";
import { useJobsSavedViews } from "@/components/v2/admin/jobs/use-jobs-saved-views";
import { SavedViewsControls } from "@/components/v2/admin/jobs/saved-views-controls";
import { emptyJobsViews, type JobsViews } from "@/lib/jobs/saved-views";
import { jobsSnapshot } from "@/lib/jobs/workspace-state";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
const viewId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const snapshot = jobsSnapshot({ ...DEFAULT_JOBS_STATE, sort: "latest", density: "compact" });
const collection = (): JobsViews => ({ version: 1, revision: 1, defaultId: viewId, views: [{ id: viewId, name: "Morning", snapshot }] });
const response = (data: JobsViews, context = "context-a") => ({ ok: true, status: 200, json: async () => ({ context, data }) });
type Deferred = { resolve: (response: any) => void; reject: (error: Error) => void; options: RequestInit };
let pending: Deferred[];
beforeEach(() => {
  pending = [];
  window.history.replaceState({ marker: true }, "", "/v2/admin/jobs");
  vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((resolve, reject) => pending.push({ resolve, reject, options }))));
});
afterEach(() => { vi.unstubAllGlobals(); });
async function respond(index: number, data = collection(), context = "context-a") {
  await act(async () => pending[index].resolve(response(data, context)));
}

function Harness({ context = "context-a", readOnly = false }: { context?: string; readOnly?: boolean }) {
  const workspace = useJobsWorkspaceState();
  return <>
    <SavedViewsControls key={context} context={context} readOnly={readOnly} state={workspace.state}
      apply={workspace.update} applyDefault={workspace.applyDefault} />
    <button onClick={() => workspace.update({ search: "typed" })}>Type filter</button>
    <output data-testid="state">{JSON.stringify(workspace.state)}</output>
  </>;
}

describe("Jobs saved view restore precedence", () => {
  it("loads a personal default on a bare URL even under StrictMode", async () => {
    render(<StrictMode><Harness /></StrictMode>);
    await respond(pending.length - 1);
    expect(screen.getByTestId("state")).toHaveTextContent('"sort":"latest"');
    expect(screen.getByTestId("state")).toHaveTextContent('"density":"compact"');
  });
  it.each(["?sort=property&page=3", "?jobsState=1"])("explicit URL %s wins over personal defaults", async query => {
    window.history.replaceState({}, "", "/v2/admin/jobs" + query);
    render(<Harness />); await respond(0);
    expect(screen.getByTestId("state")).not.toHaveTextContent('"sort":"latest"');
  });
  it("does not overwrite user edits made while preferences are loading", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Type filter"));
    await respond(0);
    expect(screen.getByTestId("state")).toHaveTextContent('"search":"typed"');
    expect(screen.getByTestId("state")).toHaveTextContent('"sort":"soonest"');
  });
  it("reset, reload and Back preserve explicit defaults and unrelated URL state", async () => {
    window.history.replaceState({ marker: true }, "", "/v2/admin/jobs?other=keep#anchor");
    const first = render(<Harness />); await respond(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset Jobs view" }));
    expect(screen.getByTestId("state")).toHaveTextContent(JSON.stringify(DEFAULT_JOBS_STATE));
    expect(window.location.search).toContain("jobsState=1"); expect(window.location.search).toContain("other=keep");
    expect(window.history.state).toEqual({ marker: true }); expect(window.location.hash).toBe("#anchor");
    first.unmount(); render(<Harness />); await respond(1);
    expect(screen.getByTestId("state")).toHaveTextContent('"sort":"soonest"');
    act(() => {
      window.history.replaceState({}, "", "/v2/admin/jobs?sort=created&page=4");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("state")).toHaveTextContent('"page":4');
    expect(screen.getByTestId("state")).toHaveTextContent('"sort":"created"');
  });
  it("Back during loading blocks a late default, including a bare destination", async () => {
    render(<Harness />);
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    await respond(0);
    expect(screen.getByTestId("state")).toHaveTextContent('"sort":"soonest"');
  });
  it("density alone preserves page, while applying a snapshot resets it", () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?page=4");
    const hook = renderHook(useJobsWorkspaceState);
    act(() => hook.result.current.update({ density: "comfortable" }));
    expect(hook.result.current.state.page).toBe(4);
    act(() => hook.result.current.update({ ...snapshot, page: 1 }));
    expect(hook.result.current.state).toMatchObject({ page: 1, sort: "latest", density: "compact" });
  });
});

describe("Jobs saved views acknowledgments and context", () => {
  it("rejects an acknowledgment that failed to persist the exact column selection", async () => {
    const hook = renderHook(() => useJobsSavedViews("context-a")); await respond(0);
    act(() => { void hook.result.current.mutate({ action: "update", id: viewId,
      snapshot: { ...snapshot, columns: { client: false, cleaner: false, schedule: false } } }); });
    await respond(1, { ...collection(), revision: 2 });
    expect(hook.result.current.saved).toBe(false);
    expect(hook.result.current.reloadRequired).toBe(true);
  });
  it("requires a reload on revision conflict without replacing local workspace edits", async () => {
    render(<Harness />); await respond(0);
    fireEvent.click(screen.getByText("Type filter"));
    fireEvent.click(screen.getByRole("button", { name: "Update selected view" }));
    await act(async () => pending[1].resolve({ ok: false, status: 409, json: async () => ({ code: "REVISION_CONFLICT", error: "Reload views before saving." }) }));
    expect(screen.getByRole("button", { name: "Update selected view" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload views" }));
    await respond(2, { ...collection(), revision: 2, views: [{ ...collection().views[0], snapshot: { ...snapshot, search: "other tab" } }] });
    expect(screen.getByTestId("state")).toHaveTextContent('"search":"typed"');
    fireEvent.click(screen.getByRole("button", { name: "Update selected view" }));
    expect(JSON.parse(pending[3].options.body as string).revision).toBe(2);
    expect(JSON.parse(pending[3].options.body as string).change.snapshot.search).toBe("typed");
    await respond(3, { ...collection(), revision: 3, views: [{ ...collection().views[0], snapshot: { ...snapshot, search: "typed" } }] });
    expect(screen.getByText("View saved.")).toBeVisible();
  });
  it("ignores an old in-flight default after a new context is denied", async () => {
    const ui = render(<Harness context="context-a" />);
    ui.rerender(<Harness context="context-b" />);
    await act(async () => pending[1].resolve({ ok: false, status: 401, json: async () => { throw new Error("HTML"); } }));
    await respond(0);
    expect(screen.getByTestId("state")).toHaveTextContent('"sort":"soonest"');
    expect(screen.queryByRole("option", { name: /Morning/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Save as new view" })).toBeDisabled();
  });
  it.each([401, 403])("clears cached views on non-JSON %s and refuses queued writes/reloads", async status => {
    const hook = renderHook(() => useJobsSavedViews("context-a")); await respond(0);
    let write: Promise<JobsViews | null>;
    act(() => { write = hook.result.current.mutate({ action: "default", id: null }); });
    const json = vi.fn().mockRejectedValue(new Error("not JSON"));
    await act(async () => { pending[1].resolve({ ok: false, status, json }); await write!; });
    expect(json).not.toHaveBeenCalled();
    expect(hook.result.current.data).toBeNull(); expect(hook.result.current.contextChanged).toBe(true);
    expect(hook.result.current.saved).toBe(false);
    await act(async () => {
      await hook.result.current.mutate({ action: "create", name: "queued", snapshot });
      await hook.result.current.reload();
    });
    expect(pending).toHaveLength(2);
  });
  it("clears cached views on a mismatched acknowledgment", async () => {
    const hook = renderHook(() => useJobsSavedViews("context-a")); await respond(0);
    act(() => { void hook.result.current.mutate({ action: "default", id: null }); });
    await respond(1, { ...collection(), revision: 2, defaultId: null }, "context-b");
    expect(hook.result.current.contextChanged).toBe(true); expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.saved).toBe(false);
  });
  it("discards in-flight responses from an old context", async () => {
    const hook = renderHook(({ context }) => useJobsSavedViews(context), { initialProps: { context: "context-a" } });
    await respond(0);
    act(() => { void hook.result.current.mutate({ action: "default", id: null }); });
    hook.rerender({ context: "context-b" });
    await respond(2, emptyJobsViews(), "context-b");
    await respond(1, { ...collection(), revision: 2, defaultId: null });
    expect(hook.result.current.data).toEqual(emptyJobsViews()); expect(hook.result.current.saved).toBe(false);
    expect(pending[2].options.headers).toMatchObject({ "x-jobs-view-context": "context-b" });
  });
  it.each(["network", "invalid-json", "invalid-ack", "false-ack"])("requires reload after unknown PATCH outcome: %s", async kind => {
    const hook = renderHook(() => useJobsSavedViews("context-a")); await respond(0);
    act(() => { void hook.result.current.mutate({ action: "default", id: null }); });
    expect(hook.result.current.saved).toBe(false);
    await act(async () => {
      if (kind === "network") pending[1].reject(new Error("connection lost"));
      else if (kind === "invalid-json") pending[1].resolve({ ok: true, status: 200, json: async () => { throw new Error("bad JSON"); } });
      else if (kind === "invalid-ack") pending[1].resolve({ ok: true, status: 200, json: async () => ({}) });
      else pending[1].resolve(response({ ...collection(), revision: 2 }));
    });
    expect(hook.result.current.reloadRequired).toBe(true); expect(hook.result.current.saved).toBe(false);
    await act(async () => { await hook.result.current.mutate({ action: "default", id: null }); });
    expect(pending).toHaveLength(2);
    act(() => { void hook.result.current.reload(); });
    await respond(2, { ...collection(), revision: 2, defaultId: null });
    expect(hook.result.current.reloadRequired).toBe(false); expect(hook.result.current.saved).toBe(false);
  });
  it("does not expose a failed initial load as empty or permit mutations", async () => {
    const hook = renderHook(() => useJobsSavedViews("context-a"));
    await act(async () => pending[0].reject(new Error("offline")));
    expect(hook.result.current.data).toBeNull();
    await act(async () => { await hook.result.current.mutate({ action: "create", name: "No", snapshot }); });
    expect(pending).toHaveLength(1);
    act(() => { void hook.result.current.reload(); }); await respond(1, emptyJobsViews());
    expect(hook.result.current.data).toEqual(emptyJobsViews());
  });
  it("keeps duplicate submissions out while a request is pending", async () => {
    const hook = renderHook(() => useJobsSavedViews("context-a")); await respond(0);
    act(() => {
      void hook.result.current.mutate({ action: "default", id: null });
      void hook.result.current.mutate({ action: "default", id: null });
    });
    expect(pending).toHaveLength(2);
    await respond(1, { ...collection(), revision: 2, defaultId: null });
    expect(hook.result.current.saved).toBe(true);
  });
});

describe("Jobs named view controls", () => {
  it("supports save as, update, rename, default/unset and delete only after acknowledgment", async () => {
    render(<Harness />); await respond(0, emptyJobsViews());
    fireEvent.click(screen.getByRole("button", { name: "Save as new view" }));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(screen.queryByText("View saved.")).toBeNull();
    const savedSnapshot = jobsSnapshot(DEFAULT_JOBS_STATE);
    let data: JobsViews = { version: 1, revision: 1, defaultId: null, views: [{ id: secondId, name: "Work", snapshot: savedSnapshot }] };
    expect(JSON.parse(pending[1].options.body as string)).toEqual({ revision: 0, change: { action: "create", name: "Work", snapshot: savedSnapshot } });
    await respond(1, data);
    expect(screen.getByRole("combobox", { name: "Personal saved view" })).toHaveValue(secondId);
    fireEvent.click(screen.getByText("Type filter"));
    fireEvent.click(screen.getByRole("button", { name: "Update selected view" }));
    data = { ...data, revision: 2, views: [{ ...data.views[0], snapshot: { ...savedSnapshot, search: "typed" } }] };
    await respond(2, data);
    fireEvent.click(screen.getByRole("button", { name: "Rename selected view" }));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    data = { ...data, revision: 3, views: [{ ...data.views[0], name: "Renamed" }] }; await respond(3, data);
    fireEvent.click(screen.getByRole("button", { name: "Set personal default" }));
    data = { ...data, revision: 4, defaultId: secondId }; await respond(4, data);
    fireEvent.click(screen.getByRole("button", { name: "Remove personal default" }));
    data = { ...data, revision: 5, defaultId: null }; await respond(5, data);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected view" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
    await respond(6, { ...emptyJobsViews(), revision: 6 });
    expect(screen.queryByRole("option", { name: "Renamed" })).toBeNull();
  });
  it("retains a failed save's name/filter but clears its queue and collection on context denial", async () => {
    render(<Harness />); await respond(0, emptyJobsViews());
    fireEvent.click(screen.getByText("Type filter"));
    fireEvent.click(screen.getByRole("button", { name: "Save as new view" }));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await act(async () => pending[1].reject(new Error("lost response")));
    expect(screen.getByLabelText("View name")).toHaveValue("Keep me");
    expect(screen.getByTestId("state")).toHaveTextContent('"search":"typed"');
    expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload views" }));
    await act(async () => pending[2].resolve({ ok: false, status: 403, json: async () => { throw new Error("HTML"); } }));
    expect(screen.queryByLabelText("View name")).toBeNull();
    expect(screen.queryByRole("option", { name: /Morning/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Save as new view" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeVisible();
  });
  it("read-only context can apply a personal view but cannot save it", async () => {
    window.history.replaceState({}, "", "/v2/admin/jobs?page=3");
    render(<Harness readOnly />); await respond(0);
    expect(screen.getByRole("button", { name: "Save as new view" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Personal saved view" }), { target: { value: viewId } });
    expect(screen.getByTestId("state")).toHaveTextContent('"page":1');
    expect(screen.getByTestId("state")).toHaveTextContent('"sort":"latest"');
    expect(pending).toHaveLength(1);
  });
});
