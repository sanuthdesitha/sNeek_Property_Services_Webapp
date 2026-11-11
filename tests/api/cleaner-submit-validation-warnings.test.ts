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
      job: { update: mocks.update, findUnique: mocks.job, updateMany: mocks.claim },
    });
    events.push("commit"); return result;
  });
  for (const fn of [mocks.report, mocks.notify, mocks.lifecycle, mocks.automations, mocks.qa, mocks.clear, mocks.lowStock]) fn.mockResolvedValue(undefined);
  mocks.unexpected.mockImplementation(() => { throw new Error("Unexpected side-effect boundary"); });
});

// Server validation on submit (2026-11 builder step): the extended answer
// rules run on the SAME effective schema; this release records violations as
// warnings on the submission and accepts it, while the rules the route already
// enforced keep rejecting exactly as before. Harness copied from
// cleaner-submit-form-contract.test.ts (unchanged there).
const rangeSchema = {
  standardSections: false,
  sections: [{ id: "s", title: "Checks", fields: [
    { id: "count", type: "number", label: "Towels left", min: 0, max: 10 },
    { id: "colour", type: "select", label: "Bag colour", options: ["Red", "Blue"] },
    { id: "phone", type: "phone", label: "Guest phone" },
  ] }],
};

describe("extended validation on submit", () => {
  it("accepts a submission that breaks only extended rules and stores the warnings server-side", async () => {
    mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, version: 1, schema: rangeSchema });
    const response = await submit({ count: 50, colour: "Green", phone: "abc", __validationWarnings: [{ fieldId: "forged", message: "x" }] });
    expect(response.status).toBe(200);
    const stored = mocks.create.mock.calls[0][0].data.data.__validationWarnings;
    expect(stored.map((w: { fieldId: string; rule: string }) => [w.fieldId, w.rule])).toEqual([
      ["count", "range"],
      ["colour", "option"],
      ["phone", "phone"],
    ]);
  });

  it("stores no warnings key when the answers are valid (a forged one is dropped)", async () => {
    mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, version: 1, schema: rangeSchema });
    const response = await submit({ count: 3, colour: "Red", phone: "+61 400 000 000", __validationWarnings: [{ fieldId: "forged", message: "x" }] });
    expect(response.status).toBe(200);
    expect(mocks.create.mock.calls[0][0].data.data.__validationWarnings).toBeUndefined();
  });

  it("still rejects a missing required answer exactly as before, writing nothing", async () => {
    const response = await submit({ uploads: { photo: ["evidence.jpg"] } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Please complete the required fields");
    expectNoWrites();
  });
});
