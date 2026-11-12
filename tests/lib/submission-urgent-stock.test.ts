// @vitest-environment node
// Wave B: "Raises an urgent stock need below N" — the durable follow-up half.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), finish: vi.fn(), transaction: vi.fn(), qa: vi.fn(), report: vi.fn(),
  urgent: vi.fn(), review: vi.fn(), submission: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findMany: mocks.list, updateMany: mocks.finish }, formSubmission: { findUnique: mocks.submission }, $transaction: mocks.transaction } }));
vi.mock("@/lib/qa/auto-assignment", () => ({ ensureQaAssignmentForCompletedJob: mocks.qa }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: mocks.report }));
vi.mock("@/lib/cleaner/submission-low-stock", () => ({ reconcileSubmissionLowStock: vi.fn(), queueLowStockReview: vi.fn() }));
vi.mock("@/lib/inventory/urgent-stock", () => ({ reportUrgentStockFromSubmission: mocks.urgent }));
vi.mock("@/lib/notifications/queue-delivery", () => ({ queueDelivery: mocks.review }));
import { enqueueSubmissionFollowups, processSubmissionFollowups } from "@/lib/cleaner/submission-followups";
import { formUrgentRequestId, raiseFormUrgentStock } from "@/lib/cleaner/submission-urgent-stock";

const request = { fieldId: "tabs", label: "Tablets left", itemId: "tabs", itemName: "Tablets", unit: "tablets", count: 2, threshold: 3 };
const urgentStock = { cleanerId: "cleaner", observedAt: "2026-11-11T01:00:00.000Z", requests: [request] };
let state: any;
const now = new Date("2026-11-11T02:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  state = { jobId: "job", submissionId: "sub", status: "PENDING", qaDone: true, reportDone: true, attempts: 0, urgentStock, urgentStockDone: false };
  mocks.list.mockResolvedValue([{ key: "receipt" }]); mocks.get.mockImplementation(async () => ({ value: state }));
  mocks.update.mockImplementation(async ({ data }) => { state = data.value; });
  mocks.finish.mockImplementation(async ({ data }) => { state = data.value; return { count: 1 }; });
  mocks.transaction.mockImplementation(async (run: any) => run({ $executeRaw: vi.fn(), appSetting: { findUnique: mocks.get, update: mocks.update }, user: { findMany: async () => [] } }));
  mocks.submission.mockResolvedValue({ job: { propertyId: "property" } });
  mocks.urgent.mockResolvedValue({ id: "need" });
});

it("derives one stable request id per submission and item (idempotent retries)", () => {
  expect(formUrgentRequestId("sub", "tabs")).toBe(formUrgentRequestId("sub", "tabs"));
  expect(formUrgentRequestId("sub", "tabs")).not.toBe(formUrgentRequestId("sub", "soap"));
  expect(formUrgentRequestId("sub", "tabs")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it("reports through the existing urgent stock service as the cleaner, with the count and no purchase", async () => {
  const result = await raiseFormUrgentStock("sub", urgentStock);
  expect(result).toEqual({ raised: 1, errors: [] });
  expect(mocks.urgent).toHaveBeenCalledWith({ cleanerId: "cleaner", submissionId: "sub", report: expect.objectContaining({
    propertyId: "property", itemId: "tabs", requestId: formUrgentRequestId("sub", "tabs"), observedCount: 2, purchaseQuantity: null,
    observedAt: "2026-11-11T01:00:00.000Z", note: expect.stringContaining("below 3"),
  }) });
});

it("enqueues the urgent stage only when there is something to raise", async () => {
  const tx = { appSetting: { upsert: vi.fn() } };
  await enqueueSubmissionFollowups(tx as any, { jobId: "job", submissionId: "sub", urgentStock });
  expect(tx.appSetting.upsert.mock.calls[0][0].create.value).toMatchObject({ urgentStockDone: false, urgentStock });
  await enqueueSubmissionFollowups(tx as any, { jobId: "job", submissionId: "sub2" });
  expect(tx.appSetting.upsert.mock.calls[1][0].create.value.urgentStock).toBeUndefined();
});

it("records a failure, keeps the receipt pending, tells the office once and retries without raising twice", async () => {
  mocks.urgent.mockRejectedValueOnce(new Error("Item is unavailable."));
  await processSubmissionFollowups(now);
  expect(state).toMatchObject({ status: "PENDING", urgentStockDone: false, failedStages: ["URGENT_STOCK"], urgentStockErrors: ["Tablets: Item is unavailable."] });
  expect(mocks.review).toHaveBeenCalledTimes(1);
  await processSubmissionFollowups(new Date(now.getTime() + 6 * 60_000));
  expect(state).toMatchObject({ status: "DONE", urgentStockDone: true, urgentStockErrors: [] });
  expect(mocks.urgent).toHaveBeenCalledTimes(2);
  expect(mocks.review).toHaveBeenCalledTimes(1);
  // Done receipts are never processed again.
  await processSubmissionFollowups(new Date(now.getTime() + 12 * 60_000));
  expect(mocks.urgent).toHaveBeenCalledTimes(2);
});
