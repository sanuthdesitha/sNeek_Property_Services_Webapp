// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), finish: vi.fn(), transaction: vi.fn(), qa: vi.fn(), report: vi.fn(), lowStock: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findMany: mocks.list, updateMany: mocks.finish }, $transaction: mocks.transaction } }));
vi.mock("@/lib/qa/auto-assignment", () => ({ ensureQaAssignmentForCompletedJob: mocks.qa }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: mocks.report }));
vi.mock("@/lib/cleaner/submission-low-stock", () => ({ reconcileSubmissionLowStock: mocks.lowStock, queueLowStockReview: mocks.review }));
import { enqueueSubmissionFollowups, processSubmissionFollowups } from "@/lib/cleaner/submission-followups";
let state: any;
const now = new Date("2026-10-03T00:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  state = { jobId: "job", submissionId: "submission", status: "PENDING", qaDone: false, reportDone: false, attempts: 0 };
  mocks.list.mockResolvedValue([{ key: "receipt" }]); mocks.get.mockImplementation(async () => ({ value: state }));
  mocks.update.mockImplementation(async ({ data }) => { state = data.value; });
  mocks.finish.mockImplementation(async ({ data }) => { state = data.value; return { count: 1 }; });
  mocks.transaction.mockImplementation(async run => run({ $executeRaw: vi.fn(), appSetting: { findUnique: mocks.get, update: mocks.update } }));
  mocks.qa.mockResolvedValue(undefined); mocks.report.mockResolvedValue(undefined);
});
it("enqueues a pending receipt on caller transaction", async () => {
  const tx = { appSetting: { upsert: vi.fn() } };
  await enqueueSubmissionFollowups(tx as any, { jobId: "job", submissionId: "submission" });
  expect(tx.appSetting.upsert.mock.calls[0][0]).toMatchObject({ create: { value: { status: "PENDING", qaDone: false, reportDone: false } }, update: {} });
});
it("retains failed stage and retries it without duplicating successful QA", async () => {
  mocks.report.mockRejectedValueOnce(new Error("storage failure"));
  await processSubmissionFollowups(now);
  expect(state).toMatchObject({ status: "PENDING", qaDone: true, reportDone: false, failedStages: ["REPORT"] });
  await processSubmissionFollowups(new Date(now.getTime() + 6 * 60_000));
  expect(state.status).toBe("DONE"); expect(mocks.qa).toHaveBeenCalledTimes(1); expect(mocks.report).toHaveBeenCalledTimes(2);
  expect(mocks.finish.mock.calls[0][0].where.value.path).toEqual(["lease"]);
});
it("does not take over a live worker lease", async () => {
  state = { ...state, status: "RUNNING", leasedAt: now.toISOString() };
  await processSubmissionFollowups(now);
  expect(mocks.qa).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
});

it("keeps failed low-stock reconciliation pending and retries without repeating QA/report", async () => {
  state = { ...state, propertyId: "property", lowStockRows: [{ itemId: "item" }], lowStockDone: false };
  mocks.lowStock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  await processSubmissionFollowups(now);
  expect(state).toMatchObject({ status: "PENDING", failedStages: ["LOW_STOCK"] });
  await processSubmissionFollowups(new Date(now.getTime() + 6 * 60_000));
  expect(state.status).toBe("DONE");
  expect(mocks.qa).toHaveBeenCalledTimes(1);
  expect(mocks.lowStock).toHaveBeenCalledTimes(2);
});
it.each([undefined, {}, { jobId: "job" }, { jobId: "job", submissionId: "submission", status: "DONE" }])("ignores incomplete or completed receipts", async value => {
 state = value;
 await processSubmissionFollowups(now);
 expect(mocks.qa).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("honors retry backoff", async () => {
 state.retryAt = new Date(now.getTime() + 60_000).toISOString();
 await processSubmissionFollowups(now);
 expect(mocks.update).not.toHaveBeenCalled();
});
it("reclaims expired leases and legacy missing attempt counts", async () => {
 state = { ...state, status: "RUNNING", leasedAt: new Date(now.getTime() - 16 * 60_000).toISOString(), attempts: undefined };
 const result = await processSubmissionFollowups(now, "submission");
 expect(state).toMatchObject({ status: "DONE", attempts: 1 });
 expect(result.completed).toBe(1);
 expect(mocks.list.mock.calls[0][0].where.key).toBe("cleaner_submission_followups_v1:submission");
});
it("recovers a running receipt with a missing lease timestamp", async () => {
 state.status = "RUNNING";
 await processSubmissionFollowups();
 expect(state.status).toBe("DONE");
});
it("retries QA alone when report already succeeded", async () => {
 mocks.qa.mockRejectedValueOnce(new Error("QA unavailable"));
 await processSubmissionFollowups(now);
 expect(state).toMatchObject({ status: "PENDING", failedStages: ["QA_ASSIGNMENT"], reportDone: true });
 await processSubmissionFollowups(new Date(now.getTime() + 6 * 60_000));
 expect(mocks.report).toHaveBeenCalledTimes(1); expect(state.status).toBe("DONE");
});
it("persists missing property and office notice failures for retry", async () => {
 state.lowStockRows = [{ itemId: "item" }];
 mocks.review.mockRejectedValue(new Error("queue unavailable"));
 await processSubmissionFollowups(now);
 expect(state.failedStages).toEqual(["LOW_STOCK", "LOW_STOCK_REVIEW_NOTICE"]);
 expect(mocks.lowStock).not.toHaveBeenCalled(); expect(state.status).toBe("PENDING");
});
it("enqueues stock payload in submission transaction and leaves work pending", async () => {
 const tx = { appSetting: { upsert: vi.fn() } };
 const lowStockRows = [{ itemId: "item" }] as any;
 await enqueueSubmissionFollowups(tx as any, { jobId: "job", submissionId: "submission", propertyId: "property", lowStockRows });
 expect(tx.appSetting.upsert.mock.calls[0][0].create.value).toMatchObject({ lowStockRows, propertyId: "property", lowStockDone: false });
});
it("does not rerun completed stock stage while QA retries", async () => {
 state = { ...state, lowStockDone: true, lowStockRows: [{ itemId: "item" }] };
 await processSubmissionFollowups(now);
 expect(mocks.lowStock).not.toHaveBeenCalled(); expect(state.status).toBe("DONE");
});
it("does not announce completion or report readiness after losing its lease", async () => {
 mocks.finish.mockResolvedValue({ count: 0 });
 const result = await processSubmissionFollowups(now);
 expect(result).toEqual({ scanned: 1, completed: 0, reportReadySubmissionIds: [] });
 expect(mocks.finish.mock.calls[0][0].where.value).toEqual({ path: ["lease"], equals: expect.any(String) });
});
