import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoReviewPanel } from "@/components/v2/qa/photo-review-panel";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const base = { enabled: true, hasSubmission: true, canApprove: true, scoreReview: { id: "qa", score: 90 } };
const finding = { id: "m1:0", mediaId: "m1", fieldId: "shower", fieldLabel: "Shower", description: "Glass: Water spots", severity: "minor", confidence: 0.9, confidenceBand: "high", criterion: "Glass", observation: "Water spots", referenceMediaKey: "form-references/a.jpg", region: { x: 0.1, y: 0.5, width: 0.3, height: 0.25 }, outcome: "issue" };
const ready = { ...base, photos: [{ mediaId: "m1", url: "https://signed.example/m1.jpg", referenceUrls: [] }], review: { id: "r", status: "READY", settings: { minConfidence: 0.8, maxScoreContribution: 10, minorPoints: 3, majorPoints: 6 }, result: { totalPhotos: 2, observations: [
  { mediaId: "m1", fieldId: "shower", fieldLabel: "Shower", assessment: "issue", outcome: "issue", criteria: "No water spots", summary: "Spots", findings: [finding] },
  { mediaId: "m2", fieldId: "mirror", fieldLabel: "Mirror", assessment: "inconclusive", outcome: "cannot_tell", reason: "Mirror not in frame", summary: "Not visible", findings: [] },
] } } };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeEach(() => vi.useRealTimers());

it("shows outcomes, the cannot-tell reason, the criteria, the confidence band and a numbered region box", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(ready)));
  const view = render(<PhotoReviewPanel jobId="job-1" />);
  expect(await screen.findByText(/Shower · Review suggested issue/)).toBeInTheDocument();
  expect(screen.getByText(/Mirror · Cannot tell/)).toBeInTheDocument();
  expect(screen.getByText("Why: Mirror not in frame")).toBeInTheDocument();
  expect(screen.getByText("Acceptance criteria: No water spots")).toBeInTheDocument();
  expect(screen.getByText(/high confidence/)).toBeInTheDocument();
  const box = view.container.querySelector('span[style*="left: 10%"]') as HTMLElement;
  expect(box).not.toBeNull();
  expect(box.style.top).toBe("50%"); expect(box.style.width).toBe("30%"); expect(box.style.height).toBe("25%");
  expect(screen.getByText(/numbered boxes mark the findings below/)).toBeInTheDocument();
});

it("previews the deduction with the review's own points", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(ready)));
  render(<PhotoReviewPanel jobId="job-1" />);
  const box = await screen.findByLabelText(/Approve finding: Glass: Water spots/);
  await act(async () => { (box as HTMLInputElement).click(); });
  expect(screen.getByText(/Selected deduction:/).textContent).toContain("3 points");
});

it("polls quietly while analysis runs and stops when it is ready", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const running = { ...base, photos: [], review: { id: "r", status: "RUNNING", settings: { minConfidence: 0.8, maxScoreContribution: 10 }, result: { totalPhotos: 2, observations: [] } } };
  const fetchMock = vi.fn().mockResolvedValueOnce(ok(running)).mockResolvedValueOnce(ok(running)).mockResolvedValue(ok(ready));
  vi.stubGlobal("fetch", fetchMock);
  render(<PhotoReviewPanel jobId="job-1" />);
  expect(await screen.findByText(/progress updates here automatically/)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Loading photo review…")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(await screen.findByText(/Shower · Review suggested issue/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
