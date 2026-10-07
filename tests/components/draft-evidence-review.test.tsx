import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DraftEvidenceReview } from "@/components/v2/admin/jobs/draft-evidence-review";
const row = { key: "forms/old-job/capture/cleaner/photo.jpg", name: "Old photo", previewUrl: "/fixture.jpg", version: "a".repeat(64), removed: false, issues: ["Stored under another job"], source: { jobId: "old-job", captureId: "capture", userId: "cleaner", legacy: false }, locations: [{ type: "bulkPool" }], receipts: [{ id: "capture", formRevision: "old-version", draftIdentity: "old-context" }] };
let fetcher: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const review = (locked = false) => ({ jobId: "job", locked, rows: [row], history: [] });
beforeEach(() => { fetcher = vi.fn(async () => json(review())); vi.stubGlobal("fetch", fetcher); vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("shows original provenance and requires a reason plus confirmation", async () => {
  render(<DraftEvidenceReview jobId="job" />); await screen.findByText("Stored under another job");
  expect(screen.getByText("Capture time is not available from this receipt. Any original photo stamp is unchanged.")).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Discard draft reference" }); expect(button).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for discarding Old photo" }), { target: { value: "This image belongs to the previous job." } });
  vi.mocked(window.confirm).mockReturnValueOnce(false); fireEvent.click(button); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("prevents repeated overrides and checks acknowledgement before reporting success", async () => {
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation(async (_url, options) => options?.method === "POST" ? new Promise(r => { resolve = r; }) : json(review()));
  render(<DraftEvidenceReview jobId="job" />); await screen.findByText("Stored under another job");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "This image belongs to the previous job." } });
  const button = screen.getByRole("button", { name: "Discard draft reference" }); fireEvent.click(button); fireEvent.click(button);
  expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
  await act(async () => resolve(json({ ok: true, key: "wrong-key", discardedReference: true })));
  expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
});
it("keeps saved evidence visible after failure and allows retry with the reason", async () => {
  fetcher.mockImplementation(async (_url, options) => options?.method === "POST" ? json({ error: "Audit unavailable. Retry." }, 500) : json(review()));
  render(<DraftEvidenceReview jobId="job" />); await screen.findByText("Stored under another job");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Wrong historical job evidence" } });
  fireEvent.click(screen.getByRole("button", { name: "Discard draft reference" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Audit unavailable"); expect(screen.getByRole("textbox")).toHaveValue("Wrong historical job evidence");
  expect(screen.getByRole("button", { name: "Discard draft reference" })).toBeEnabled();
});
it("is read-only for submitted jobs", async () => {
  fetcher.mockResolvedValue(json(review(true))); render(<DraftEvidenceReview jobId="job" />);
  await screen.findByText(/Review is read-only/); expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button", { name: "Discard draft reference" })).toBeNull();
});
it("fails closed after access is revoked", async () => {
  fetcher.mockResolvedValue(json({ error: "FORBIDDEN" }, 403)); render(<DraftEvidenceReview jobId="job" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("FORBIDDEN"); expect(screen.queryByRole("textbox")).toBeNull();
});
it("reloads the audit history after confirmed resolution", async () => {
  let removed = false;
  fetcher.mockImplementation(async (_url, options) => {
    if (options?.method === "POST") { removed = true; return json({ ok: true, key: row.key, discardedReference: true }); }
    return json(removed ? { ...review(), rows: [{ ...row, removed: true }], history: [{ id: "audit", action: "OFFICE_DISCARD_DRAFT_REFERENCE", user: { name: "Office User" }, createdAt: "2026-10-07T00:00:00Z", after: { reason: "Wrong historical job evidence" } }] } : review());
  });
  render(<DraftEvidenceReview jobId="job" />); await screen.findByText("Stored under another job");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Wrong historical job evidence" } }); fireEvent.click(screen.getByRole("button", { name: "Discard draft reference" }));
  await waitFor(() => expect(screen.getByText("Removed from draft")).toBeInTheDocument()); expect(await screen.findByText("Office draft-reference override")).toBeInTheDocument();
});
