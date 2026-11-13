import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoIntegrityFlags } from "@/components/v2/qa/photo-integrity-flags";

const report = {
  hasSubmission: true,
  photos: [{ mediaId: "a", fieldLabel: "Kitchen", state: "checked", error: null, capturedAt: null, capturedAtSource: null }, { mediaId: "b", fieldLabel: "Bath", state: "not_checked", error: null, capturedAt: null, capturedAtSource: null }],
  flags: [{ kind: "reused_from_earlier_job", mediaId: "a", fieldLabel: "Kitchen", detail: "The same file was submitted for the clean on 2026-10-02. Check whether this photo was taken today.", relatedJobId: "job-0", relatedMediaId: "old" }],
  clockWindow: null,
  counts: { photos: 2, checked: 1, notChecked: 1, couldNotCheck: 0, captureTimeRecorded: 0 },
  timezone: "Australia/Sydney",
};
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(report)))); });
afterEach(() => vi.unstubAllGlobals());

function open() {
  const details = screen.getByText(/Photo checks \(duplicates/).closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

it("loads nothing until opened, then shows flags as things to look at with unchecked photos listed", async () => {
  render(<PhotoIntegrityFlags jobId="job-1" />);
  expect(fetchMock).not.toHaveBeenCalled();
  open();
  expect(await screen.findByText("1 photo to look at")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith("/api/qa/jobs/job-1/photo-integrity", expect.objectContaining({ cache: "no-store" }));
  expect(screen.getByText(/Matches an earlier clean/)).toBeVisible();
  expect(screen.getByText("Bath: Not checked yet")).toBeVisible();
  expect(screen.getByText(/1 of 2 photos checked/)).toBeVisible();
  expect(screen.getByText("No clock times to compare camera times with.")).toBeVisible();
});

it("closes and forgets the previous job's flags when the job changes", async () => {
  const view = render(<PhotoIntegrityFlags jobId="job-1" />);
  open();
  await screen.findByText("1 photo to look at");
  view.rerender(<PhotoIntegrityFlags jobId="job-2" />);
  expect(screen.queryByText("1 photo to look at")).not.toBeInTheDocument();
});

it("shows a retry on failure", async () => {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "Photo checks could not be loaded. Try again." }), { status: 503 })));
  render(<PhotoIntegrityFlags jobId="job-1" />);
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Photo checks could not be loaded. Try again.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});
