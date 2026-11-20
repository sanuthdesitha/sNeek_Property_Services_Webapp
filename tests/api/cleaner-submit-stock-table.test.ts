// @vitest-environment node
/**
 * Stock used tables (field type "inventory") on the real submit route:
 * the server reads the job property's stock itself, enforces the same
 * required / whole-number rule as the phone, merges table usage with the
 * "Stock & consumables used" block (the table wins for the items it shows)
 * and hands one usage map to the existing once-per-job deduction.
 * Harness copied from cleaner-submit-form-effects.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { enqueuePropertyModelTraining } from "@/lib/ai/property-model-training";
import { JobStatus, JobType, Role } from "@prisma/client";
vi.mock("@/lib/ai/property-model-training", () => ({ enqueuePropertyModelTraining: vi.fn().mockResolvedValue(false) }));

const mocks = vi.hoisted(() => ({
  role: vi.fn(), assignment: vi.fn(), job: vi.fn(), template: vi.fn(), timeLog: vi.fn(), closeClock: vi.fn(),
  claim: vi.fn(), transaction: vi.fn(), create: vi.fn(), media: vi.fn(), update: vi.fn(),
  settings: vi.fn(), continuation: vi.fn(), tasks: vi.fn(),
  report: vi.fn(), notify: vi.fn(), lifecycle: vi.fn(), automations: vi.fn(), qa: vi.fn(),
  clear: vi.fn(), lowStock: vi.fn(), unexpected: vi.fn(), templates: vi.fn(), anchor: vi.fn(), provision: vi.fn(),
  draft: vi.fn(), lock: vi.fn(), query: vi.fn(),
  office: vi.fn(), officeNotice: vi.fn(), resolveIssue: vi.fn(), resolveTask: vi.fn(), clockApproval: vi.fn(), caseCreate: vi.fn(), caseNotify: vi.fn(), stockReceipt: vi.fn(), stockWrite: vi.fn(), laundry: vi.fn(), pay: vi.fn(), payExisting: vi.fn(), followupQueue: vi.fn(),
  damageReport: vi.fn(), stocked: vi.fn(), countSupersede: vi.fn(), countCreate: vi.fn(), activeItems: vi.fn(),
  deduct: vi.fn(),
}));
vi.mock("@/lib/cleaner/submission-followups", () => ({ enqueueSubmissionFollowups: mocks.followupQueue,
  processSubmissionFollowups: async () => { await mocks.qa("job"); await mocks.report("job"); return { reportReadySubmissionIds: ["submission"] }; } }));
vi.mock("@/lib/db", () => ({ db: {
  user: { findMany: mocks.office }, notification: { createMany: mocks.officeNotice },
  jobAssignment: { findFirst: mocks.assignment, findMany: async () => [] },
  job: { findUnique: mocks.job, updateMany: mocks.claim },
  formTemplate: { findUnique: mocks.template, findMany: mocks.templates, findFirst: mocks.anchor, create: mocks.provision },
  timeLog: { findFirst: mocks.timeLog, findMany: async () => [], update: mocks.update, updateMany: mocks.closeClock },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: mocks.continuation }));
vi.mock("@/lib/job-tasks/service", () => ({ listCleanerJobTasks: mocks.tasks, applyCleanerJobTaskUpdates: mocks.unexpected }));
vi.mock("@/lib/inventory/stock", () => ({ deductStockFromSubmission: mocks.deduct, fireLowStockSideEffects: mocks.lowStock }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: mocks.report }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://media.invalid/${key}` }));
vi.mock("@/lib/cases/service", () => ({ createCase: mocks.caseCreate }));
vi.mock("@/lib/cases/notifications", () => ({ notifyCaseCreated: mocks.caseNotify }));
vi.mock("@/lib/laundry/cleaner-status", () => ({ applyCleanerLaundryStatusUpdate: mocks.laundry }));
vi.mock("@/lib/cleaner/shared-job-draft", () => ({ clearSharedCleanerJobDraft: mocks.clear,
  getSharedCleanerJobDraft: mocks.draft, withSharedCleanerJobDraftLock: mocks.lock }));
vi.mock("@/lib/notifications/client-job-notifications", () => ({ sendClientJobNotification: mocks.notify }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: mocks.lifecycle }));
vi.mock("@/lib/notifications/client-automation", () => ({ queueClientPostJobAutomations: mocks.automations }));
vi.mock("@/lib/qa/auto-assignment", () => ({ tryEnsureQaAssignmentForCompletedJob: mocks.qa }));
vi.mock("@/lib/qa/annotation-composite", () => ({ compositeAnnotated: mocks.unexpected }));
vi.mock("@/lib/accountability/rotation", () => ({
  deriveRotationalCompletion: () => ({ completedItemKeys: [], allRotationalItemKeys: [] }),
  applyRotationCompletion: mocks.unexpected,
}));

import { POST } from "@/app/api/cleaner/jobs/[id]/submit/route";
import { assembleJobForm } from "@/lib/forms/assemble-job-form";
import * as formAssembly from "@/lib/forms/assemble-job-form";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { buildReworkFormSchema } from "@/lib/qa/rework-jobs";
import { collectRequiredAnswerFields, collectRequiredUploadFields } from "@/lib/forms/visibility";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";

const extras = [{ id: "oven-extra", label: "<b>Oven &amp; trays</b>", instructions: "<p>Remove trays</p><p>Wipe clean</p>" }];
const baseSchema = {
  standardSections: false,
  inventoryConfig: { mode: "selected", itemIds: ["soap"] },
  customRoot: { preserved: true },
  sections: [{ label: "Kitchen", fields: [
    { id: "photo", type: "upload", label: "Evidence", required: true },
    { id: "note", type: "textarea", label: "Work note", required: true },
  ] }],
};
const areas = [{ id: "kitchen", label: "Kitchen", photoKeys: ["qa-before.jpg"] }];
let job: Record<string, unknown>;
let events: string[];
const context = { params: { id: "job" } };
function submit(data: Record<string, unknown>, templateId = "template", contract: Record<string, unknown> = {}) {
  return POST(new NextRequest("http://localhost/api/cleaner/jobs/job/submit", {
    method: "POST", body: JSON.stringify({ templateId, data, ...contract }),
  }), context);
}
function expectNoWrites() {
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.report).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.unexpected).not.toHaveBeenCalled();
  expect(mocks.provision).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); events = [];
  job = {
    id: "job", propertyId: "property", status: JobStatus.IN_PROGRESS,
    jobType: JobType.AIRBNB_TURNOVER, isRework: false,
    property: { name: "Test property", laundryEnabled: false, inventoryEnabled: false },
    internalNotes: serializeJobInternalNotes({ additionals: extras }),
  };
  mocks.office.mockResolvedValue([]);
  mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER } });
  mocks.assignment.mockResolvedValue({ id: "assignment" });
  mocks.job.mockImplementation(async () => job);
  mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, version: 1, schema: baseSchema });
  mocks.templates.mockImplementation(async () => { const value = await mocks.template(); return value ? [value] : []; });
  mocks.anchor.mockResolvedValue({ id: "template", isActive: false, serviceType: JobType.AIRBNB_TURNOVER, schema: {} });
  mocks.timeLog.mockResolvedValue(null);
  mocks.closeClock.mockResolvedValue({ count: 1 });
  mocks.settings.mockResolvedValue({
    autoClockOut: {}, noPhotoExemptCleanerIds: [],
    accountability: { requiredChecklistTicksBlockSubmit: true },
    finalCheckup: { enabled: false },
  });
  mocks.continuation.mockResolvedValue([]); mocks.tasks.mockResolvedValue([]);
  mocks.claim.mockImplementation(async () => { events.push("claim"); return { count: 1 }; });
  mocks.draft.mockResolvedValue(null); mocks.query.mockResolvedValue([]);
  mocks.lock.mockImplementation(async (_job, callback, tx) => tx ? callback(tx) : mocks.transaction(callback));
  mocks.create.mockImplementation(async () => { events.push("snapshot"); return { id: "submission" }; });
  mocks.media.mockResolvedValue({ count: 1 }); mocks.update.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    events.push("transaction");
    const result = await callback({
      $queryRaw: mocks.query,
      appSetting: { findUnique: mocks.stockReceipt, create: mocks.stockWrite, upsert: mocks.stockWrite },
      stockTx: { findFirst: async () => null },
      issueTicket: { updateMany: mocks.resolveIssue }, jobTask: { updateMany: mocks.resolveTask },
      timeLogAdjustmentRequest: { create: mocks.clockApproval }, notification: { createMany: mocks.officeNotice },
      user: { findMany: mocks.office, findUnique: async () => ({ isActive: true, role: Role.CLEANER, extraRoles: [] }) },
      jobAssignment: { findFirst: mocks.assignment },
      formTemplate: { findUnique: mocks.template, findMany: mocks.templates, findFirst: mocks.anchor, create: mocks.provision },
      timeLog: { findFirst: mocks.timeLog, findMany: async () => [], update: mocks.update, updateMany: mocks.closeClock },
      cleanerPayAdjustment: { create: mocks.pay, findFirst: mocks.payExisting },
      formSubmission: { create: mocks.create }, submissionMedia: { createMany: mocks.media },
      damageReport: { findFirst: mocks.damageReport }, propertyStock: { findMany: mocks.stocked },
      job: { update: mocks.update, findUnique: mocks.job, updateMany: mocks.claim },
      // Wave F: stock count answers become count observations in the same transaction.
      stockCountObservation: { updateMany: mocks.countSupersede, createMany: mocks.countCreate },
      inventoryItem: { findMany: mocks.activeItems },
    });
    events.push("commit"); return result;
  });
  for (const fn of [mocks.report, mocks.notify, mocks.lifecycle, mocks.automations, mocks.qa, mocks.clear, mocks.lowStock]) fn.mockResolvedValue(undefined);
  mocks.unexpected.mockImplementation(() => { throw new Error("Unexpected side-effect boundary"); });
  mocks.damageReport.mockResolvedValue(null);
  mocks.stocked.mockResolvedValue([{ itemId: "tabs" }]);
  mocks.activeItems.mockResolvedValue([{ id: "tabs", name: "Tablets" }]);
  mocks.countCreate.mockImplementation(async (args: { data: unknown[] }) => ({ count: args.data.length }));
  mocks.caseCreate.mockResolvedValue({ id: "case" });
  mocks.create.mockImplementation(async () => { events.push("snapshot"); return { id: "submission", createdAt: new Date("2026-11-11T01:00:00Z") }; });
});

const STOCK_ROWS = [
  { onHand: 10, item: { id: "tp", name: "Toilet paper", sku: "DEF-TP", category: "Bathroom", location: "BATHROOM", unit: "roll" } },
  { onHand: 4, item: { id: "soap", name: "Hand soap", sku: "DEF-HANDSOAP", category: "Bathroom", location: "BATHROOM", unit: "bottle" } },
  { onHand: 6, item: { id: "caps", name: "Coffee capsules", sku: "DEF-COFFEECAPS", category: "Kitchen", location: "KITCHEN", unit: "capsule" } },
];

function withStockSchema(fields: unknown[], root: Record<string, unknown> = {}) {
  mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, version: 1,
    schema: { standardSections: false, ...root, sections: [{ id: "s", title: "Rooms", fields }] } });
}
const bathroom = { id: "bath_used", type: "inventory", label: "Bathroom supplies used", stockArea: "bathroom", required: true };
const kitchen = { id: "kitchen_used", type: "inventory", label: "Kitchen items used", stockArea: "kitchen" };
const everything = { id: "all_used", type: "inventory", label: "All stock used", stockArea: "all" };

describe("Stock used tables on submit", () => {
  beforeEach(() => {
    job = { ...job, property: { ...(job.property as Record<string, unknown>), inventoryEnabled: true } };
    mocks.stocked.mockResolvedValue(STOCK_ROWS);
    mocks.stockReceipt.mockResolvedValue(null);
    mocks.deduct.mockResolvedValue({ lowStockRows: [] });
  });

  it("reads the job's own property stock, active items only, without cost or supplier", async () => {
    withStockSchema([bathroom]);
    await submit({ stockTableUsage: { tp: 2, soap: 0 } });
    const query = mocks.stocked.mock.calls[0][0];
    expect(query.where).toEqual({ propertyId: "property", item: { isActive: true } });
    expect(JSON.stringify(query.select)).not.toMatch(/supplier|cost|parLevel|reorderThreshold/);
  });

  it("refuses a required table with an unanswered row and writes nothing", async () => {
    withStockSchema([bathroom]);
    const response = await submit({ stockTableUsage: { tp: 2 } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.invalidFields[0]).toMatchObject({ fieldId: "bath_used", rule: "stock-table" });
    expect(body.error).toContain("Hand soap");
    expectNoWrites();
    expect(mocks.deduct).not.toHaveBeenCalled();
  });

  it("accepts an explicit 0 and deducts only what was used", async () => {
    withStockSchema([bathroom]);
    const response = await submit({ stockTableUsage: { tp: 2, soap: 0 } });
    expect(response.status).toBe(200);
    expect(mocks.deduct).toHaveBeenCalledTimes(1);
    expect(mocks.deduct.mock.calls[0][2]).toEqual({ tp: 2 });
    const record = mocks.create.mock.calls[0][0].data.data.__stockTable;
    expect(record.fields[0].rows).toEqual([
      { itemId: "tp", name: "Toilet paper", unit: "roll", used: 2 },
      { itemId: "soap", name: "Hand soap", unit: "bottle", used: 0 },
    ]);
  });

  it.each([[-1], [1.5], ["two"]])("refuses %s in words", async (bad) => {
    withStockSchema([bathroom]);
    const response = await submit({ stockTableUsage: { tp: bad, soap: 0 } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Toilet paper: the amount used (cannot be less than 0|must be a whole number of items|must be a number)/);
    expect(mocks.deduct).not.toHaveBeenCalled();
  });

  it("counts an item shown by two tables once (shared answer)", async () => {
    withStockSchema([bathroom, kitchen, everything]);
    const response = await submit({ stockTableUsage: { tp: 3, soap: 0, caps: 2 } });
    expect(response.status).toBe(200);
    expect(mocks.deduct.mock.calls[0][2]).toEqual({ caps: 2, tp: 3 });
  });

  it("lets a table replace the Stock & consumables block for the items it shows", async () => {
    withStockSchema([bathroom]);
    const response = await submit({ stockTableUsage: { tp: 1, soap: 0 }, inventoryUsage: { tp: 5, caps: 4 } });
    expect(response.status).toBe(200);
    // tp from the table (1, not the block's 5); caps from the block (no table shows it).
    expect(mocks.deduct.mock.calls[0][2]).toEqual({ tp: 1, caps: 4 });
  });

  it("does not deduct items no visible table shows, and records them", async () => {
    withStockSchema([kitchen]);
    const response = await submit({ stockTableUsage: { caps: 1, "foreign-item": 9 } });
    expect(response.status).toBe(200);
    expect(mocks.deduct.mock.calls[0][2]).toEqual({ caps: 1 });
    expect(mocks.create.mock.calls[0][0].data.data.__stockTable.ignoredItemIds).toEqual(["foreign-item"]);
  });

  it("does not block when the property has no items in the table's area", async () => {
    mocks.stocked.mockResolvedValue(STOCK_ROWS.filter((row) => row.item.location !== "BATHROOM"));
    withStockSchema([bathroom]);
    const response = await submit({});
    expect(response.status).toBe(200);
    expect(mocks.deduct).not.toHaveBeenCalled();
  });

  it("asks nothing where the property does not track stock", async () => {
    job = { ...job, property: { ...(job.property as Record<string, unknown>), inventoryEnabled: false } };
    withStockSchema([bathroom]);
    const response = await submit({});
    expect(response.status).toBe(200);
    expect(mocks.stocked).not.toHaveBeenCalled();
    expect(mocks.deduct).not.toHaveBeenCalled();
  });

  it("keeps the first clean's deduction on a resubmission (reset or rework of the same job)", async () => {
    withStockSchema([bathroom]);
    mocks.stockReceipt.mockResolvedValue({ key: "job_submission_stock_v1:job" });
    const response = await submit({ stockTableUsage: { tp: 2, soap: 0 } });
    expect(response.status).toBe(200);
    expect(mocks.deduct).not.toHaveBeenCalled();
    expect(mocks.stockWrite.mock.calls[0][0].create.value).toMatchObject({ status: "PENDING_ADMIN_REVIEW", usage: { tp: 2 } });
  });

  it("ignores a client-sent __stockTable record", async () => {
    withStockSchema([bathroom]);
    await submit({ stockTableUsage: { tp: 0, soap: 0 }, __stockTable: { fields: [{ fieldId: "forged" }] } });
    const record = mocks.create.mock.calls[0][0].data.data.__stockTable;
    expect(record.fields.map((field: { fieldId: string }) => field.fieldId)).toEqual(["bath_used"]);
  });

  it("refuses a different cleaner who is not assigned before reading stock", async () => {
    mocks.assignment.mockResolvedValue(null);
    withStockSchema([bathroom]);
    const response = await submit({ stockTableUsage: { tp: 1, soap: 0 } });
    expect(response.status).toBe(403);
    expect(mocks.stocked).not.toHaveBeenCalled();
    expect(mocks.deduct).not.toHaveBeenCalled();
  });
});
