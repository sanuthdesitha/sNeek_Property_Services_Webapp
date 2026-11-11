// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  EMPTY_ACTIVITY,
  activityBatchEnded,
  activityFinished,
  activityInterrupted,
  activityStarted,
  classifyActivityRequest,
  isActivityBusy,
  summarizeActivity,
  type ActivityRequest,
  type ActivityState,
} from "@/lib/client/activity-summary";

const none = new URLSearchParams();
const classify = (path: string, forced = false) => classifyActivityRequest(path, none, forced);
const file = classify("/api/uploads/direct")!;
const open = classify("/api/uploads/presign-multipart")!;
const part = classify("/api/uploads/part")!;
const complete = classify("/api/uploads/complete-multipart")!;
const abort = classify("/api/uploads/abort-multipart")!;

function run(state: ActivityState, request: ActivityRequest, ok = true) {
  return activityFinished(activityStarted(state, request), request, ok);
}

describe("which requests are summarised", () => {
  it("treats each upload step by what it means for a whole file", () => {
    expect(file.kind).toBe("upload-file");
    expect(classify("/api/uploads/presign")!.kind).toBe("upload-file");
    expect(open.kind).toBe("upload-open");
    expect(classify("/api/uploads/resume-multipart")!.kind).toBe("upload-open");
    expect(part.kind).toBe("upload-part");
    expect(complete.kind).toBe("upload-complete");
    expect(abort.kind).toBe("upload-abort");
  });

  it("does not present reading a stored file as an upload", () => {
    expect(classify("/api/uploads/access")).toBeNull();
  });

  it("labels documents and ignores ordinary quick requests unless forced", () => {
    expect(classify("/api/reports/job-1/pdf")!.label).toBe("Preparing report PDF");
    expect(classify("/api/reports/job-1/generate")!.label).toBe("Generating report");
    expect(classify("/api/invoices/inv-1/download")!.label).toBe("Preparing invoice PDF");
    expect(classify("/api/laundry/reports")!.label).toBe("Preparing laundry report");
    expect(classify("/api/admin/jobs")).toBeNull();
    expect(classify("/api/admin/jobs", true)!.kind).toBe("task");
    expect(classifyActivityRequest("/api/admin/x", new URLSearchParams("download=1"), false)!.label).toBe("Preparing download");
  });
});

describe("one summary for a batch", () => {
  it("counts whole files across a five-photo batch", () => {
    let state = EMPTY_ACTIVITY;
    for (let index = 0; index < 5; index += 1) state = activityStarted(state, file);
    expect(summarizeActivity(state)).toMatchObject({ tone: "working", message: "Uploading 1 of 5 files", finished: 0, total: 5, indeterminate: false });
    state = activityFinished(state, file, true);
    state = activityFinished(state, file, true);
    expect(summarizeActivity(state)).toMatchObject({ message: "Uploading 3 of 5 files", finished: 2, total: 5 });
    for (let index = 0; index < 3; index += 1) state = activityFinished(state, file, true);
    expect(isActivityBusy(state)).toBe(false);
    expect(summarizeActivity(state)).toMatchObject({ tone: "success", message: "5 files uploaded", finished: 5, total: 5 });
  });

  it("counts a multipart video as one file however many parts it has", () => {
    let state = run(EMPTY_ACTIVITY, open);
    expect(isActivityBusy(state)).toBe(true); // Open between requests.
    for (let index = 0; index < 12; index += 1) state = run(state, part);
    expect(summarizeActivity(state)).toMatchObject({ message: "Uploading 1 file", total: 1, indeterminate: true });
    state = run(state, complete);
    expect(summarizeActivity(state)).toMatchObject({ tone: "success", message: "1 file uploaded" });
  });

  it("states failures once for the batch and never calls them uploaded", () => {
    let state = EMPTY_ACTIVITY;
    state = run(state, file, true);
    state = run(state, file, false);
    state = run(state, open, false);
    const summary = summarizeActivity(state);
    expect(summary.tone).toBe("danger");
    expect(summary.message).toBe("2 of 3 uploads did not finish. Check the details and retry.");
  });

  it("reports an aborted or stalled multipart file as not finished", () => {
    const aborted = run(run(EMPTY_ACTIVITY, open), abort);
    expect(summarizeActivity(aborted)).toMatchObject({ tone: "danger", message: "The upload did not finish. Check the details and retry." });
    const stalled = activityInterrupted(run(EMPTY_ACTIVITY, open));
    expect(isActivityBusy(stalled)).toBe(false);
    expect(summarizeActivity(stalled).tone).toBe("danger");
  });

  it("ignores a completion that has no open file", () => {
    const state = run(EMPTY_ACTIVITY, complete);
    expect(state.uploadsDone).toBe(0);
    expect(state.uploadsOpen).toBe(0);
  });

  it("combines uploads and a document into one sentence", () => {
    const report = classify("/api/reports/job-1/pdf")!;
    let state = activityStarted(activityStarted(EMPTY_ACTIVITY, file), file);
    state = activityStarted(state, report);
    expect(summarizeActivity(state).message).toBe("Uploading 1 of 2 files · Preparing report PDF");
    state = activityFinished(activityFinished(activityFinished(state, file, true), file, true), report, true);
    expect(summarizeActivity(state).message).toBe("2 files uploaded · Report PDF ready");
  });

  it("names a single failed document and counts several running ones", () => {
    const report = classify("/api/reports/job-1/pdf")!;
    expect(summarizeActivity(run(EMPTY_ACTIVITY, report, false)).message).toBe("Preparing report PDF failed. Check the details and retry.");
    const two = activityStarted(activityStarted(EMPTY_ACTIVITY, report), report);
    expect(summarizeActivity(two).message).toBe("2 tasks in progress");
  });
});

describe("a component that measures its own upload", () => {
  const batch = (overrides: Partial<import("@/lib/client/activity-batches").LiveBatch> = {}) => ({
    id: "capture", total: 4, done: 1, failed: 0,
    inFlight: [{ percent: 50, phase: "uploading" as const }], ...overrides,
  });

  it("joins the same sentence and adds measured bytes to the fraction", () => {
    const summary = summarizeActivity(EMPTY_ACTIVITY, [batch()]);
    expect(isActivityBusy(EMPTY_ACTIVITY, [batch()])).toBe(true);
    expect(summary).toMatchObject({ tone: "working", message: "Uploading 2 of 4 files", finished: 1, total: 4, indeterminate: false, percent: 38 });
  });

  it("gives a single large video a real percentage instead of a spinner", () => {
    const summary = summarizeActivity(EMPTY_ACTIVITY, [batch({ total: 1, done: 0, inFlight: [{ percent: 64, phase: "uploading" }] })]);
    expect(summary).toMatchObject({ message: "Uploading 1 file", indeterminate: false, percent: 64 });
  });

  it("says a video is being prepared while it is still compressing", () => {
    const summary = summarizeActivity(EMPTY_ACTIVITY, [batch({ total: 1, done: 0, inFlight: [{ percent: null, phase: "compressing" }] })]);
    expect(summary.message).toBe("Preparing video for upload");
    expect(summary.indeterminate).toBe(true);
  });

  it("never shows 100% while a file is still in flight", () => {
    const summary = summarizeActivity(EMPTY_ACTIVITY, [batch({ total: 1, done: 0, inFlight: [{ percent: 100, phase: "uploading" }] })]);
    expect(summary.percent).toBe(99);
  });

  it("folds the finished batch into the closing summary without counting cancelled files", () => {
    const ended = activityBatchEnded(EMPTY_ACTIVITY, { done: 3, failed: 0 });
    expect(summarizeActivity(ended)).toMatchObject({ tone: "success", message: "3 files uploaded" });
    const withFailure = activityBatchEnded(EMPTY_ACTIVITY, { done: 2, failed: 1 });
    expect(summarizeActivity(withFailure).message).toBe("1 of 3 uploads did not finish. Check the details and retry.");
  });
});
