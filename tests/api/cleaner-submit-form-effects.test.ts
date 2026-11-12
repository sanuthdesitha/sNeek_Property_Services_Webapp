// @vitest-environment node
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
  damageReport: vi.fn(), stocked: vi.fn(),
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
vi.mock("@/lib/inventory/stock", () => ({ deductStockFromSubmission: mocks.unexpected, fireLowStockSideEffects: mocks.lowStock }));
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
    });
    events.push("commit"); return result;
  });
  for (const fn of [mocks.report, mocks.notify, mocks.lifecycle, mocks.automations, mocks.qa, mocks.clear, mocks.lowStock]) fn.mockResolvedValue(undefined);
  mocks.unexpected.mockImplementation(() => { throw new Error("Unexpected side-effect boundary"); });
  mocks.damageReport.mockResolvedValue(null);
  mocks.stocked.mockResolvedValue([{ itemId: "tabs" }]);
  mocks.caseCreate.mockResolvedValue({ id: "case" });
  mocks.create.mockImplementation(async () => { events.push("snapshot"); return { id: "submission", createdAt: new Date("2026-11-11T01:00:00Z") }; });
});


// Wave B (2026-11): Table / Stock count answers, question effects and the
// organisation's extended-validation switch on the real submit route.
// Harness copied from cleaner-submit-validation-warnings.test.ts.
function withSchema(fields: unknown[]) {
  mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, version: 1,
    schema: { standardSections: false, sections: [{ id: "s", title: "Kitchen", fields }] } });
}
const stockField = { id: "tabs", type: "stock_count", label: "Dishwasher tablets left", stockItemId: "tabs", stockItemName: "Tablets", unit: "tablets",
  effects: [{ kind: "urgent-stock-below", threshold: 3 }] };
const damageField = { id: "damaged", type: "yesno", label: "Anything damaged or missing?", effects: [{ kind: "damage-report", when: "yes", category: "Breakage" }] };
const tableField = { id: "grid", type: "table", label: "Linen", required: true,
  table: { columns: [{ id: "c1", label: "Item", cellType: "text", required: true }, { id: "c2", label: "Count", cellType: "number" }], rowMode: "dynamic", minRows: 1, maxRows: 2 } };

describe("structured answers on submit", () => {
  it("rejects a table that breaks its rules and writes nothing", async () => {
    withSchema([tableField]);
    const response = await submit({ grid: [{ c1: "Towels", c2: "lots" }] });
    expect(response.status).toBe(400);
    expect((await response.json()).invalidFields[0]).toMatchObject({ fieldId: "grid", rule: "table" });
    expectNoWrites();
  });

  it("accepts a valid table and stock count and records the count on the submission", async () => {
    withSchema([tableField, { ...stockField, effects: undefined }]);
    const response = await submit({ grid: [{ c1: "Towels", c2: 4 }], tabs: { itemId: "tabs", count: 7 } });
    expect(response.status).toBe(200);
    const data = mocks.create.mock.calls[0][0].data.data;
    expect(data.__formEffects.stockCounts).toEqual([expect.objectContaining({ itemId: "tabs", count: 7 })]);
    expect(data.__formEffects.urgentStock).toEqual([]);
    expect(mocks.followupQueue.mock.calls[0][1].urgentStock).toBeUndefined();
  });

  it("rejects a stock count for another item", async () => {
    withSchema([stockField]);
    const response = await submit({ tabs: { itemId: "soap", count: 1 } });
    expect(response.status).toBe(400);
    expectNoWrites();
  });
});

describe("question effects on submit", () => {
  it("queues one urgent stock need below the threshold on the durable follow-up", async () => {
    withSchema([stockField]);
    const response = await submit({ tabs: { itemId: "tabs", count: 2 } });
    expect(response.status).toBe(200);
    const queued = mocks.followupQueue.mock.calls[0][1].urgentStock;
    expect(queued).toMatchObject({ cleanerId: "cleaner", observedAt: "2026-11-11T01:00:00.000Z" });
    expect(queued.requests).toEqual([expect.objectContaining({ itemId: "tabs", count: 2, threshold: 3 })]);
  });

  it("raises nothing at or above the threshold", async () => {
    withSchema([stockField]);
    await submit({ tabs: { itemId: "tabs", count: 3 } });
    expect(mocks.followupQueue.mock.calls[0][1].urgentStock).toBeUndefined();
  });

  it("records an unstocked item as skipped instead of queueing a retry loop", async () => {
    withSchema([stockField]);
    mocks.stocked.mockResolvedValue([]);
    await submit({ tabs: { itemId: "tabs", count: 0 } });
    expect(mocks.followupQueue.mock.calls[0][1].urgentStock).toBeUndefined();
    expect(mocks.create.mock.calls[0][0].data.data.__formEffects.urgentStock[0]).toMatchObject({ outcome: "skipped" });
  });

  it("opens the existing private damage case once when Yes is answered without a damage report", async () => {
    withSchema([damageField]);
    const response = await submit({ damaged: true });
    expect(response.status).toBe(200);
    expect(mocks.caseCreate).toHaveBeenCalledTimes(1);
    expect(mocks.caseCreate.mock.calls[0][0]).toMatchObject({ caseType: "DAMAGE", source: "CLEANER_SUBMIT", clientVisible: false, title: expect.stringContaining("Breakage") });
    expect(mocks.create.mock.calls[0][0].data.data.__formEffects.damage[0]).toMatchObject({ outcome: "case-from-form", area: "Kitchen" });
  });

  it("does not double-report when the cleaner already submitted a damage report", async () => {
    withSchema([damageField]);
    mocks.damageReport.mockResolvedValue({ id: "report" });
    await submit({ damaged: true });
    expect(mocks.caseCreate).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0].data.data.__formEffects.damage[0].outcome).toBe("covered-by-damage-report");
  });

  it("does nothing for No", async () => {
    withSchema([damageField]);
    await submit({ damaged: false });
    expect(mocks.caseCreate).not.toHaveBeenCalled();
    expect(mocks.damageReport).not.toHaveBeenCalled();
  });
});

describe("organisation switch for extended validation", () => {
  const rangeSchema = [{ id: "count", type: "number", label: "Towels left", min: 0, max: 10 }];
  const switchedOn = "2026-11-10T00:00:00.000Z";
  function settingsWith(formValidation: unknown) {
    mocks.settings.mockResolvedValue({ autoClockOut: {}, noPhotoExemptCleanerIds: [], accountability: { requiredChecklistTicksBlockSubmit: true }, finalCheckup: { enabled: false }, formValidation });
  }

  it("rejects when switched on and the cleaner started after the switch", async () => {
    withSchema(rangeSchema);
    settingsWith({ enforceExtended: true, enforcedSince: switchedOn });
    mocks.timeLog.mockResolvedValue({ id: "clock", startedAt: new Date("2026-11-10T00:00:01.000Z") });
    const response = await submit({ count: 50 });
    expect(response.status).toBe(400);
    expect((await response.json()).invalidFields[0]).toMatchObject({ fieldId: "count", rule: "range" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("accepts with warnings when the cleaner started before the switch", async () => {
    withSchema(rangeSchema);
    settingsWith({ enforceExtended: true, enforcedSince: switchedOn });
    mocks.timeLog.mockResolvedValue({ id: "clock", startedAt: new Date("2026-11-09T23:59:59.000Z") });
    const response = await submit({ count: 50 });
    expect(response.status).toBe(200);
    expect(mocks.create.mock.calls[0][0].data.data.__validationWarnings[0]).toMatchObject({ rule: "range" });
  });

  it("accepts with warnings while switched off (default)", async () => {
    withSchema(rangeSchema);
    settingsWith(undefined);
    const response = await submit({ count: 50 });
    expect(response.status).toBe(200);
  });
});
