import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoReviewPanel } from "@/components/v2/qa/photo-review-panel";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const finding = { id: "finding", mediaId: "media", fieldId: "floor", fieldLabel: "Kitchen", description: "Debris on floor", severity: "major", confidence: .95 };
function payload(patch = {}) { return { enabled: true, hasSubmission: true, canApprove: true, scoreReview: { id: "qa", score: 90 }, photos: [], review: { id: "analysis", status: "READY", result: { totalPhotos: 1, observations: [{ mediaId: "media", fieldId: "floor", fieldLabel: "Kitchen", assessment: "issue", summary: "Visible debris", findings: [finding, { ...finding, id: "low", description: "Unclear mark", confidence: .2 }] }] }, settings: { minConfidence: .8, maxScoreContribution: 10 } }, ...patch }; }
const ok = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => refresh.mockClear());
afterEach(() => vi.unstubAllGlobals());
it("requires human selection and reason, carries expected score, and displays saved decision", async () => {
  const completed = payload(); (completed.review as any).reviewedAt = "now"; (completed.review as any).decision = { action: "approve", deduction: 5, scoreBefore: 90, scoreAfter: 85, reason: "Confirmed visible debris" };
  const fetch = vi.fn().mockResolvedValueOnce(ok(payload())).mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok(completed)); vi.stubGlobal("fetch", fetch);
  render(<PhotoReviewPanel jobId="job" />);
  const submit = await screen.findByRole("button", { name: "Approve selected deduction" });
  expect(submit).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Approve finding: Unclear mark")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Approve finding: Debris on floor")); expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Confirmed visible debris" } }); fireEvent.click(submit);
  await screen.findByText("Approved deduction: 5 points (90 → 85).");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "approve", analysisId: "analysis", reason: "Confirmed visible debris", findingIds: ["finding"], expectedReviewId: "qa", expectedScore: 90 });
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("dismisses with explicit reason without submitting score changes", async () => {
  const fetch = vi.fn().mockResolvedValue(ok(payload())); vi.stubGlobal("fetch", fetch);
  render(<PhotoReviewPanel jobId="job" />); await screen.findByLabelText("Review reason");
  fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Reflection only" } });
  fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestions" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "dismiss", analysisId: "analysis", reason: "Reflection only" });
});
it("shows pending, empty and read-only states without automatic POST", async () => {
  const fetch = vi.fn().mockResolvedValue(ok(payload({ review: { id: "r", status: "PENDING", settings: { minConfidence: .8, maxScoreContribution: 10 }, result: null } }))); vi.stubGlobal("fetch", fetch);
  const view = render(<PhotoReviewPanel jobId="job" />); await screen.findByText(/Background analysis continues/);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(ok(payload({ hasSubmission: false, review: null, enabled: false })));
  view.rerender(<PhotoReviewPanel jobId="empty" />); await screen.findByText("No cleaner form has been submitted yet.");
  expect(screen.queryByRole("button", { name: "Analyze submitted photos" })).toBeNull();
  fetch.mockResolvedValue(ok(payload({ canApprove: false })));
  view.rerender(<PhotoReviewPanel jobId="readonly" />); await screen.findByText(/Complete QA scoring first/);
  expect(screen.getByLabelText("Approve finding: Debris on floor")).toBeDisabled();
});
it("preserves reviewer input when authoritative score conflicts", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(ok(payload())).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "The QA score changed. Refresh and review the deduction again." }) }); vi.stubGlobal("fetch", fetch);
  render(<PhotoReviewPanel jobId="job" />); await screen.findByLabelText("Review reason");
  fireEvent.click(screen.getByLabelText("Approve finding: Debris on floor")); fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Confirmed" } });
  fireEvent.click(screen.getByRole("button", { name: "Approve selected deduction" }));
  await screen.findByRole("alert"); expect(screen.getByLabelText("Review reason")).toHaveValue("Confirmed"); expect(refresh).not.toHaveBeenCalled();
});
it("ignores late old-job GET and POST responses", async () => {
  let resolvePost!: (value: unknown) => void; let resolveOldGet!: (value: unknown) => void;
  const fetch = vi.fn().mockResolvedValueOnce(ok(payload())).mockImplementationOnce(() => new Promise(resolve => { resolvePost = resolve; })).mockImplementationOnce(() => new Promise(resolve => { resolveOldGet = resolve; })).mockResolvedValueOnce(ok(payload({ hasSubmission: false, review: null })));
  vi.stubGlobal("fetch", fetch); const view = render(<PhotoReviewPanel jobId="first" />);
  await screen.findByLabelText("Review reason"); fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Not a concern" } }); fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestions" }));
  view.rerender(<PhotoReviewPanel jobId="second" />); view.rerender(<PhotoReviewPanel jobId="third" />);
  await screen.findByText("No cleaner form has been submitted yet.");
  await act(async () => { resolveOldGet(ok(payload())); resolvePost({ ok: false, json: async () => ({ error: "Old job failure" }) }); });
  expect(screen.queryByText("Old job failure")).toBeNull(); expect(screen.queryByLabelText("Review reason")).toBeNull(); expect(refresh).not.toHaveBeenCalled();
});
