import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TeamDefaultControls } from "@/components/v2/admin/jobs/team-default-controls";
import { useJobsWorkspaceState } from "@/components/v2/admin/jobs/use-jobs-workspace-state";
import { DEFAULT_JOBS_STATE, jobsSnapshot } from "@/lib/jobs/workspace-state";
import { emptyJobsTeamDefault } from "@/lib/jobs/team-default";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
const snapshot = jobsSnapshot({ ...DEFAULT_JOBS_STATE, search: "Team search" });
const data = { ...emptyJobsTeamDefault(), revision: 1, snapshot, updatedBy: "owner", updatedAt: "2026-09-01T00:00:00Z" };
const props = { context: "context", snapshot, snapshotInvalid: false, personalLoaded: true, hasPersonalDefault: false, applyDefault: vi.fn(() => true) };
const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body });
beforeEach(() => { fetchMock.mockReset().mockResolvedValue(response({ context: "context", canPublish: true, data })); props.applyDefault.mockClear(); window.history.replaceState({}, "", "/v2/admin/jobs"); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
it("waits for personal defaults before applying the optional team fallback", async () => {
  const view = render(<TeamDefaultControls {...props} personalLoaded={false} />);
  await screen.findByText("Available for admin and operations"); expect(props.applyDefault).not.toHaveBeenCalled();
  view.rerender(<TeamDefaultControls {...props} />);
  await waitFor(() => expect(props.applyDefault).toHaveBeenCalledWith(snapshot));
});
it("never overrides an existing personal default", async () => {
  render(<TeamDefaultControls {...props} hasPersonalDefault />); await screen.findByText("Available for admin and operations"); expect(props.applyDefault).not.toHaveBeenCalled();
});
it.each(["?search=Explicit", "?jobsState=1"])("preserves explicit URL state %s", async query => {
  window.history.replaceState({}, "", `/v2/admin/jobs${query}`);
  function Harness() { const value = useJobsWorkspaceState(); return <><output aria-label="Current search">{value.state.search || "Empty search"}</output><TeamDefaultControls {...props} applyDefault={value.applyDefault} personalLoaded={value.ready} /></>; }
  render(<Harness />); await screen.findByText("Available for admin and operations");
  expect(screen.getByLabelText("Current search").textContent).toBe(query.includes("Explicit") ? "Explicit" : "Empty search");
});
it("disables publisher actions for operations readers", async () => {
  fetchMock.mockResolvedValue(response({ context: "context", canPublish: false, data }));
  render(<TeamDefaultControls {...props} />); await screen.findByText("Available for admin and operations");
  expect(screen.getByRole("button", { name: "Publish current view" })).toBeDisabled();
});
it("requires confirmation and a valid server acknowledgement before reporting publication", async () => {
  fetchMock.mockResolvedValueOnce(response({ context: "context", canPublish: true, data }))
    .mockResolvedValueOnce(response({ context: "context", canPublish: true, data: { ...data, revision: 2 } }));
  render(<TeamDefaultControls {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish current view" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Publish current view" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
  expect(await screen.findByText("Team default saved.")).toBeVisible();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ revision: 1, snapshot });
});
it("locks publication after revision conflict until a successful reload", async () => {
  fetchMock.mockResolvedValueOnce(response({ context: "context", canPublish: true, data })).mockResolvedValueOnce(response({}, 409));
  render(<TeamDefaultControls {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish current view" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Publish current view" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
  await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Confirm publication" })).toBeDisabled();
  expect(screen.queryByText("Team default saved.")).toBeNull();
});
it("never applies an invalid response or a different context", async () => {
  fetchMock.mockResolvedValue(response({ context: "other", canPublish: true, data }));
  render(<TeamDefaultControls {...props} />); await screen.findByRole("alert"); expect(props.applyDefault).not.toHaveBeenCalled();
});

it("does not override edits made while the team fallback is loading", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockReturnValue(new Promise(done => { resolve = done; }));
  function Harness() {
    const value = useJobsWorkspaceState();
    return <><output aria-label="Current search">{value.state.search || "Empty search"}</output><button onClick={() => value.update({ search: "My current edit" })}>Edit current view</button><TeamDefaultControls {...props} applyDefault={value.applyDefault} personalLoaded={value.ready} /></>;
  }
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Edit current view" }));
  await act(async () => resolve(response({ context: "context", canPublish: true, data })));
  expect(screen.getByLabelText("Current search")).toHaveTextContent("My current edit");
});

it("removes an existing team default only after confirmation", async () => {
  fetchMock.mockResolvedValueOnce(response({ context: "context", canPublish: true, data }))
    .mockResolvedValueOnce(response({ context: "context", canPublish: true, data: { ...data, revision: 2, snapshot: null } }));
  render(<TeamDefaultControls {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove team default" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Remove team default" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await screen.findByText("Team default saved."); expect(JSON.parse(fetchMock.mock.calls[1][1].body).snapshot).toBeNull();
});
it("lets an administrator cancel without publishing", async () => {
  render(<TeamDefaultControls {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish current view" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Publish current view" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("retries failed reads without applying a nonexistent fallback", async () => {
  fetchMock.mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response({ context: "context", canPublish: true, data: emptyJobsTeamDefault() }));
  render(<TeamDefaultControls {...props} />); await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Reload team default" }));
  await screen.findByText("Not set"); expect(props.applyDefault).not.toHaveBeenCalled();
});
it.each([401, 403])("clears publisher capability on access denial %s", async status => {
  fetchMock.mockResolvedValue(response({}, status)); render(<TeamDefaultControls {...props} />);
  await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Publish current view" })).toBeDisabled();
});
it("blocks malformed current snapshots from publication", async () => {
  render(<TeamDefaultControls {...props} snapshotInvalid />);
  expect(await screen.findByRole("button", { name: "Publish current view" })).toBeDisabled();
});
it("does not report success for a stale publication acknowledgement", async () => {
  render(<TeamDefaultControls {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish current view" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Publish current view" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
  await screen.findByRole("alert"); expect(screen.queryByText("Team default saved.")).toBeNull();
});
it("discards late responses after leaving the account context", async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<TeamDefaultControls {...props} />); view.unmount();
  await act(async () => resolve(response({ context: "context", canPublish: true, data })));
  expect(props.applyDefault).not.toHaveBeenCalled();
});

it("closes the publication dialog with Escape without mutation", async () => {
  render(<TeamDefaultControls {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish current view" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Publish current view" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("requires a page reload when the server detects another context", async () => {
  fetchMock.mockResolvedValue(response({ code: "CONTEXT_CHANGED" }, 409));
  render(<TeamDefaultControls {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Account context changed. Reload the page.");
  expect(props.applyDefault).not.toHaveBeenCalled();
});
