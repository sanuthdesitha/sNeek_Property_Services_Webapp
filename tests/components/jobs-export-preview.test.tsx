import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JobsExportPreview } from "@/components/v2/admin/jobs/export-preview";
const fetchMock = vi.fn(); const createUrl = vi.fn(); const revoke = vi.fn();
const response = (count = 1, totalCount = count) => ({ jobs: Array.from({ length: count }, (_, index) => ({ id: `job-${index}`, jobNumber: `JOB-${index}`, jobType: "GENERAL_CLEAN", status: "ASSIGNED", scheduledDate: "2026-09-09T00:00:00Z", property: { name: `Property ${index}` }, assignments: [] })), pagination: { page: 1, limit: 5000, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / 5000)), hasMore: totalCount > 5000 } });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); createUrl.mockReturnValue("blob:export"); URL.createObjectURL = createUrl; URL.revokeObjectURL = revoke; vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); fetchMock.mockResolvedValue({ ok: true, json: async () => response() }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function open() { fireEvent.click(screen.getByRole("button", { name: "Export", exact: true })); }
it("waits for restored filter state before allowing export", async () => {
  const view = render(<JobsExportPreview query="old" disabled />); expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Export" })); expect(fetchMock).not.toHaveBeenCalled();
  view.rerender(<JobsExportPreview query="restored" disabled={false} />); open(); await screen.findByText("Download reviewed CSV (1)");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/jobs?restored");
});
it("reviews the frozen snapshot before preparing any download", async () => {
  const view = render(<JobsExportPreview query="page=1&limit=5000&search=Beach" context="actor" />); expect(fetchMock).not.toHaveBeenCalled(); open();
  const button = await screen.findByText("Download reviewed CSV (1)"); expect(createUrl).not.toHaveBeenCalled(); expect(screen.getByText(/Selected checkboxes do not limit/)).toBeVisible();
  fireEvent.click(button); expect(createUrl).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce(); expect(screen.getByText(/Your browser handles saving/)).toBeVisible();
  fireEvent.click(button); expect(revoke).toHaveBeenCalledWith("blob:export"); view.unmount(); expect(revoke).toHaveBeenCalledTimes(2);
});
it("does not turn a failed HTTP response into an empty or successful export", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => response(0) }).mockResolvedValueOnce({ ok: true, json: async () => response() });
  render(<JobsExportPreview query="page=1" />); open(); await screen.findByRole("alert"); expect(screen.queryByText(/No jobs match/)).toBeNull(); expect(createUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Refresh preview")); await screen.findByText("Download reviewed CSV (1)");
});
it("aborts and discards previous actor/filter results", async () => {
  let resolve!: (result: unknown) => void; fetchMock.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<JobsExportPreview query="search=old" context="actor" />); open(); const signal = fetchMock.mock.calls[0][1].signal;
  view.rerender(<JobsExportPreview query="search=new" context="other" />); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ok: true, json: async () => response() })); expect(screen.queryByRole("dialog")).toBeNull(); expect(createUrl).not.toHaveBeenCalled();
});
it("supports reviewing every row through bounded pages", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => response(26) }); render(<JobsExportPreview query="page=1" />); open();
  await screen.findByText("Preview rows 1–25 of 26."); expect(screen.queryByText("Property 25")).toBeNull();
  fireEvent.click(screen.getByText("Next rows")); expect(screen.getByText("Property 25")).toBeVisible(); expect(screen.getByText("Next rows")).toBeDisabled();
  fireEvent.click(screen.getByText("Previous rows")); expect(screen.getByText("Property 0")).toBeVisible();
});
it("does not offer an empty download", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => response(0) }); render(<JobsExportPreview query="page=1" />); open(); await screen.findByText("No jobs match these export filters."); expect(screen.queryByText(/Download reviewed/)).toBeNull();
});
it("reports local download failure without success", async () => {
  createUrl.mockImplementation(() => { throw new Error(); }); render(<JobsExportPreview query="page=1" />); open(); fireEvent.click(await screen.findByText("Download reviewed CSV (1)"));
  await screen.findByText("Could not prepare the download. Try again."); expect(screen.queryByText(/CSV prepared for/)).toBeNull();
});
it("requires explicit acceptance of a limited 5000-row snapshot", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => response(5000, 5001) }); render(<JobsExportPreview query="page=1" />); open();
  await screen.findByText("5000 rows prepared from 5001 matching jobs."); expect(screen.getByRole("alert")).toHaveTextContent("only the first 5,000");
  expect(screen.getByText("Download reviewed 5,000 rows")).toBeEnabled(); expect(createUrl).not.toHaveBeenCalled();
});
it("reports malformed JSON as an incomplete response without a download", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("private details"); } }); render(<JobsExportPreview query="page=1" />); open();
  await screen.findByText("The export response was incomplete. Refresh and try again."); expect(screen.queryByText(/private details/)).toBeNull(); expect(createUrl).not.toHaveBeenCalled();
});
it("handles non-Error transport rejection with a safe fallback", async () => {
  fetchMock.mockRejectedValue("unavailable"); render(<JobsExportPreview query="page=1" />); open(); await screen.findByText("Could not load export.");
});
it("reloads a new snapshot when reopened rather than reusing the old review", async () => {
  render(<JobsExportPreview query="page=1" />); open(); await screen.findByText("Download reviewed CSV (1)");
  fireEvent.click(screen.getByRole("button", { name: "Close", exact: true })); expect(screen.queryByRole("dialog")).toBeNull();
  fetchMock.mockResolvedValue({ ok: true, json: async () => response(2) }); open(); await screen.findByText("Download reviewed CSV (2)"); expect(fetchMock).toHaveBeenCalledTimes(2);
});
