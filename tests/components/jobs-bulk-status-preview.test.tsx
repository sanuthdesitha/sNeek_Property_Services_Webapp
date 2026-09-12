import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkStatusPreviewControls } from "@/components/v2/admin/jobs/bulk-status-preview";
const fetchMock = vi.fn(); const applied = vi.fn(); const busy = vi.fn();
const data = { context: "actor", status: "UNASSIGNED", reviewToken: "a".repeat(64), rows: [{ id: "job", label: "Beach house", before: "ASSIGNED", after: "UNASSIGNED", blocked: false, consequences: ["Clear completion time.", "Remove 1 active cleaner assignment."] }] };
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, json: async () => value });
const props = { jobIds: ["job"], status: "UNASSIGNED", context: "actor", onApplied: applied, onBusy: busy };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(response(data)); });
it("requires explicit review and confirmed whole-batch acknowledgement", async () => {
  render(<BulkStatusPreviewControls {...props} />); expect(fetchMock).not.toHaveBeenCalled(); expect(screen.queryByText(/Apply reviewed/)).toBeNull();
  fireEvent.click(screen.getByText("Review changes")); fireEvent.click(await screen.findByText("Apply reviewed changes (1)"));
  await screen.findByRole("alert"); expect(applied).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("outcome is unknown");
  expect(screen.getByText("Refresh preview")).toBeDisabled();
});
it("applies frozen review token once and confirms the exact result", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({ ok: true, updated: 1, status: "UNASSIGNED" }));
  render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes"));
  expect(await screen.findByText("Remove 1 active cleaner assignment.")).toBeVisible();
  fireEvent.click(screen.getByText("Apply reviewed changes (1)")); await waitFor(() => expect(applied).toHaveBeenCalledOnce());
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ jobIds: ["job"], status: "UNASSIGNED", reviewToken: data.reviewToken });
});
it("shows conflicts as unapplied and requires a new preview", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({ error: "Jobs changed." }, 409));
  render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes")); fireEvent.click(await screen.findByText("Apply reviewed changes (1)"));
  await screen.findByText("Jobs changed."); expect(screen.queryByText(/Apply reviewed/)).toBeNull(); expect(applied).not.toHaveBeenCalled(); expect(screen.getByText("Review changes")).toBeEnabled();
});
it("blocks a preview containing any invoiced job", async () => {
  fetchMock.mockResolvedValue(response({ ...data, rows: [{ ...data.rows[0], before: "INVOICED", blocked: true }] }));
  render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes")); expect(await screen.findByText("Apply reviewed changes (1)")).toBeDisabled();
});
it.each([{ context: "other" }, { status: "COMPLETED" }, { rows: [] }])("rejects preview context or selection mismatch %j", async patch => {
  fetchMock.mockResolvedValue(response({ ...data, ...patch })); render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes"));
  await screen.findByRole("alert"); expect(screen.queryByText(/Apply reviewed/)).toBeNull();
});
it("ignores old preview after actor or selection changes", async () => {
  let resolve!: (value: unknown) => void; fetchMock.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes"));
  view.rerender(<BulkStatusPreviewControls {...props} context="other" />);
  await act(async () => resolve(response(data))); expect(screen.queryByText("Beach house")).toBeNull();
});
it("allows retrying a failed read without dispatching a write", async () => {
  fetchMock.mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(data));
  render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes")); await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Review changes")); await screen.findByText("Apply reviewed changes (1)"); expect(applied).not.toHaveBeenCalled();
});
it("does not report an old actor's applied result after account change", async () => {
  let resolve!: (value: unknown) => void; fetchMock.mockResolvedValueOnce(response(data)).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes")); fireEvent.click(await screen.findByText("Apply reviewed changes (1)"));
  view.rerender(<BulkStatusPreviewControls {...props} context="other" />);
  await act(async () => resolve(response({ ok: true, updated: 1, status: "UNASSIGNED" }))); expect(applied).not.toHaveBeenCalled();
});
it("treats unreadable mutation results as uncertain and does not retry", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error(); } });
  render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes")); fireEvent.click(await screen.findByText("Apply reviewed changes (1)"));
  await screen.findByRole("alert"); expect(fetchMock).toHaveBeenCalledTimes(2); expect(applied).not.toHaveBeenCalled();
});
it("shows a safe fallback for transport failures without Error objects", async () => {
  fetchMock.mockRejectedValue("network unavailable"); render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes"));
  await screen.findByText("Could not load preview."); expect(applied).not.toHaveBeenCalled();
});
it("handles a confirmed conflict even when its response body is absent", async () => {
  fetchMock.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(null, 409));
  render(<BulkStatusPreviewControls {...props} />); fireEvent.click(screen.getByText("Review changes")); fireEvent.click(await screen.findByText("Apply reviewed changes (1)"));
  await screen.findByText("The batch was not applied. Refresh the preview."); expect(applied).not.toHaveBeenCalled();
});
