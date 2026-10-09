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
  jobAssignment: { findFirst: mocks.assignment },
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

describe("real cleaner submit form contract", () => {
  it("submits unchanged early laundry evidence without replaying its update or losing the signature", async () => {
    (job.property as any).laundryEnabled = true;
    job.laundryTask = { confirmations: [{ id: "early", createdAt: new Date(),
      notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP", bagCount: 3, unit: "bags" }),
      bagLocation: "Shelf", s3Key: "laundry.jpg", photoUrl: "https://media.invalid/laundry.jpg" }] };
    mocks.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "laundry.jpg", fieldId: "laundry_photo", destination: { type: "laundry" } } } });
    const response = await submit({ note: "Done", signature: "data:image/png;base64,kept", uploads: { photo: ["evidence.jpg"], laundry_photo: ["laundry.jpg"] } });
    expect(response.status, JSON.stringify(await response.json())).toBe(200);
    expect(mocks.laundry).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ laundryOutcome: "READY_FOR_PICKUP", bagLocation: "Shelf", laundrySkipReasonCode: undefined, data: { signature: "data:image/png;base64,kept" } });
    expect(mocks.media.mock.calls[0][0].data).toEqual(expect.arrayContaining([expect.objectContaining({ s3Key: "laundry.jpg" })]));
  });

  it.each(["photo-replaced", "readiness-corrected", "photo-detached"])("still rejects a stale retained laundry handoff: %s", async change => {
    (job.property as any).laundryEnabled = true;
    const confirmation = { id: "early", createdAt: new Date(),
      notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: change === "readiness-corrected" ? "NOT_READY" : "READY_FOR_PICKUP", reasonCode: "LINEN_STILL_WASHING" }),
      bagLocation: "Shelf", s3Key: change === "photo-replaced" ? "replacement.jpg" : "laundry.jpg" };
    job.laundryTask = { confirmations: [confirmation] };
    mocks.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "laundry.jpg", fieldId: "laundry_photo", destination: { type: "laundry" }, detached: change === "photo-detached" } } });
    const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"], laundry_photo: ["laundry.jpg"] } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "EVIDENCE_CHANGED" });
    expectNoWrites(); expect(mocks.laundry).not.toHaveBeenCalled();
  });
  it("does not infer laundry readiness from a draft or photo without committed confirmation", async () => {
    (job.property as any).laundryEnabled = true;
    mocks.draft.mockResolvedValue({ state: { laundry: { outcome: "READY_FOR_PICKUP" } }, evidenceReceipts: { capture: { key: "laundry.jpg", fieldId: "laundry_photo", destination: { type: "laundry" } } } });
    const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"], laundry_photo: ["laundry.jpg"] } });
    expect(response.status).toBe(409); expectNoWrites();
  });
  it("uses the latest explicit cleaner correction despite later driver observations", async () => {
    (job.property as any).laundryEnabled = true;
    job.laundryTask = { confirmations: [
      { id: "driver", createdAt: new Date("2026-10-04T03:00:00Z"), notes: "Picked up", bagLocation: null, s3Key: null },
      { id: "correction", createdAt: new Date("2026-10-04T02:00:00Z"), notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "NO_PICKUP_REQUIRED", reasonCode: "NO_USED_LINEN" }), bagLocation: null, s3Key: null },
      { id: "old", createdAt: new Date("2026-10-04T01:00:00Z"), notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP" }), bagLocation: "Old location", s3Key: "old.jpg" },
    ] };
    const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"] } });
    expect(response.status, JSON.stringify(await response.json())).toBe(200);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ laundryOutcome: "NO_PICKUP_REQUIRED", laundrySkipReasonCode: "NO_USED_LINEN" });
    expect(mocks.laundry).not.toHaveBeenCalled();
  });
  it("writes an explicit ready bag count through the same final-submission transaction", async () => {
    (job.property as any).laundryEnabled = true;
    mocks.laundry.mockResolvedValue({ ok: true });
    const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"], laundry_photo: ["laundry.jpg"] } }, "template",
      { laundryOutcome: "READY_FOR_PICKUP", bagLocation: "Shelf", laundryBagCount: 3 });
    expect(response.status, JSON.stringify(await response.json())).toBe(200);
    expect(mocks.laundry).toHaveBeenCalledWith(expect.objectContaining({ laundryBagCount: 3, source: "FINAL_SUBMISSION" }), expect.objectContaining({ transaction: expect.objectContaining({ formSubmission: expect.any(Object) }) }));
    expect(mocks.create.mock.calls[0][0].data.data).not.toHaveProperty("__laundryReadyBaseline");
  });
  it.each(["bulkPool", "laundry", "carryForwardNew", "jobTask"])("rejects unused or unavailable typed %s evidence before the status claim", async type => {
    const destination = type === "jobTask" ? { type, taskId: "removed-task" } : { type };
    mocks.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "durable.jpg", fieldId: "unused", destination } } });
    const response = await submit({ note: "Done", uploads: { photo: ["other.jpg"], laundry_photo: ["durable.jpg"] },
      carryForward: { hasNew: false, newTaskNotes: [], taskPhotoKeys: { __carryForwardNew: ["durable.jpg"] } } }, "template", { jobTasks: [{ id: "removed-task", decision: "COMPLETED", proofKeys: ["durable.jpg"] }] });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "EVIDENCE_CHANGED" });
    expectNoWrites();
  });
  it("enforces server receipt ownership for legacy callers and rejects detached keys under other fields", async () => {
    mocks.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "durable.jpg", fieldId: "photo", detached: true } } });
    const response = await submit({ note: "Done", uploads: { photo: ["other.jpg"], elsewhere: ["durable.jpg"] } });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "EVIDENCE_CHANGED" });
    expectNoWrites();
  });
  it.each([false, true])("rejects a stale v2 attachment snapshot before claiming status (detached=%s)", async detached => {
    const { jobFormRevision } = await import("@/lib/forms/job-form-revision");
    const formRevision = jobFormRevision({ template: { id: "template", schema: assembleJobForm(baseSchema, extras) },
      job: job as any, settings: await mocks.settings(), canUseNoPhoto: false, finalCheckupItems: [] });
    mocks.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "durable.jpg", fieldId: "photo", detached } } });
    const response = await submit({ note: "Done", uploads: { photo: detached ? ["durable.jpg"] : ["other.jpg"] } },
      "template", { formContractVersion: 1, formRevision });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "EVIDENCE_CHANGED" });
    expect(mocks.query).toHaveBeenCalledTimes(5); expect(mocks.lock).toHaveBeenCalledTimes(2);
    expectNoWrites();
  });
  it.each([1, 2])("evaluates floorCount with the read-side property contract (%s floors)", async floorCount => {
    const { jobFormRevision } = await import("@/lib/forms/job-form-revision");
    const schema = { standardSections: false, sections: [{ id: "stairs", fields: [
      { id: "stairs-note", type: "text", label: "Stairs", required: true, conditional: { propertyField: "floorCount", value: 2 } },
    ] }] };
    (job.property as any).floorCount = floorCount;
    mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, schema });
    const revision = jobFormRevision({ template: { id: "template", schema: assembleJobForm(schema, extras) },
      job: job as any, settings: await mocks.settings(), canUseNoPhoto: false, finalCheckupItems: [] });
    const response = await submit({}, "template", { formContractVersion: 1, formRevision: revision });
    expect(response.status).toBe(floorCount === 2 ? 400 : 200);
    if (floorCount === 2) { expect(await response.json()).toMatchObject({ missingRequiredFields: [expect.objectContaining({ id: "stairs-note" })] }); expectNoWrites(); }
  });

  it("preserves legacy unknown-property semantics but rejects an unsupported v2 contract", async () => {
    const schema = { standardSections: false, sections: [{ id: "private", conditional: { propertyField: "clientId", value: "private" }, fields: [] }] };
    mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, schema });
    const rejected = await submit({}, "template", { formContractVersion: 1, formRevision: "a".repeat(64) });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toMatch(/unsupported property condition/);
    expectNoWrites();
    const legacy = await submit({});
    expect(legacy.status).toBe(200);
  });
  it.each([{}, { formRevision: "a".repeat(64) }])("rejects missing or stale v2 revisions before validation and writes (%j)", async (contract) => {
    const response = await submit({}, "template", { formContractVersion: 1, ...contract });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "FORM_CHANGED" });
    expectNoWrites();
  });

  it("accepts the server-resolved v2 revision and overwrites a forged snapshot revision", async () => {
    const { jobFormRevision } = await import("@/lib/forms/job-form-revision");
    const revision = jobFormRevision({ template: { id: "template", schema: assembleJobForm(baseSchema, extras) },
      job: job as any, settings: await mocks.settings(), canUseNoPhoto: false, finalCheckupItems: [] });
    const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"] }, __formRevision: "forged" },
      "template", { formContractVersion: 1, formRevision: revision });
    expect(response.status).toBe(200);
    expect(mocks.create.mock.calls[0][0].data.data.__formRevision).toBe(revision);
  });

  it.each([true, false])("generated rework upload validation uses the normalized read-side required set (categorized=%s)", async (categorized) => {
    job.isRework = true; job.reworkAreas = areas;
    job.internalNotes = serializeJobInternalNotes({ additionals: extras, reworkCategorized: categorized });
    mocks.template.mockResolvedValue({ id: "template", isActive: false, schema: {} });
    const generated = buildReworkFormSchema(areas, { categorized });
    const readSchema = assembleJobForm(generated, extras);
    const expected = collectRequiredUploadFields(readSchema, {}, {});
    // The current generated schema already has these upload requirements.
    // Also observe the real assembler call to guard against returning to the
    // old bypass even when raw/normalized required IDs happen to coincide.
    const assembly = vi.spyOn(formAssembly, "assembleJobForm");
    expect(expected.map((field) => field.id)).toContain("rework_area_kitchen");
    const response = await submit({});
    expect(response.status).toBe(400);
    expect((await response.json()).missingUploadFields).toEqual(expected);
    expect(assembly).toHaveBeenCalledWith(generated, extras);
    expect(assembly).toHaveReturnedWith(readSchema);
    expectNoWrites();
  });

  it.each([true, false])("generated rework answer validation uses the same normalized set after uploads are satisfied (categorized=%s)", async (categorized) => {
    job.isRework = true; job.reworkAreas = areas;
    job.internalNotes = serializeJobInternalNotes({ additionals: extras, reworkCategorized: categorized });
    mocks.template.mockResolvedValue({ id: "template", isActive: false, schema: {} });
    const readSchema = assembleJobForm(buildReworkFormSchema(areas, { categorized }), extras);
    const uploads = Object.fromEntries(collectRequiredUploadFields(readSchema, {}, {}).map((field) => [field.id, [`${field.id}.jpg`]]));
    const data = { uploads };
    const expected = collectRequiredAnswerFields(readSchema, data, {}, { requiredChecklistTicksBlockSubmit: true });
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.map((field) => field.id)).not.toContain("oven-extra");
    const response = await submit(data);
    expect(response.status).toBe(400);
    expect((await response.json()).missingRequiredFields).toEqual(expected);
    expectNoWrites();
  });

  it.each([false, true])("persists the normalized normal+additionals snapshot with the optional extra answered=%s", async (answered) => {
    const response = await submit({
      note: "Work finished", uploads: { photo: ["evidence.jpg"] },
      ...(answered ? { "oven-extra": true } : {}),
      __templateSchema: { sections: [] }, // Client cannot replace server snapshot.
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, submissionId: "submission", clockOut: null });
    expect(events).toEqual(["transaction", "claim", "snapshot", "commit"]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(enqueuePropertyModelTraining).toHaveBeenCalledWith("property", expect.objectContaining({ formSubmission: { create: mocks.create }, submissionMedia: { createMany: mocks.media } }));
    const stored = mocks.create.mock.calls[0][0].data;
    expect(stored).toMatchObject({ jobId: "job", templateId: "template", submittedById: "cleaner" });
    expect(stored.data.__templateSchema).toEqual(assembleJobForm(baseSchema, extras));
    expect(stored.data.__templateSchema).toMatchObject({ standardSections: false, customRoot: { preserved: true } });
    expect(stored.data.__templateSchema.sections.map((section: { id: string }) => section.id)).toEqual(["kitchen", "additionals"]);
    expect(stored.data.__templateSchema.sections[1].fields).toEqual([{
      id: "oven-extra", type: "checkbox", required: false,
      label: "Oven & trays", instructions: "Remove trays\nWipe clean",
    }]);
    expect(stored.data.__templateSchema.sections[0].fields).toEqual(normalizeFormSchema(baseSchema).sections[0].fields);
    expect(stored.data["oven-extra"]).toBe(answered ? true : undefined);
    expect(stored.data.__templateVersion).toBe("template");
    expect(mocks.media.mock.calls[0][0].data).toEqual([expect.objectContaining({ fieldId: "photo", s3Key: "evidence.jpg", submissionId: "submission" })]);
    expect(mocks.report).toHaveBeenCalledWith("job");
    expect(mocks.clear).toHaveBeenCalledWith("job", expect.objectContaining({ formSubmission: { create: mocks.create } }));
    expect(mocks.unexpected).not.toHaveBeenCalled();
    expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("preserves active assignment authorization before template access", async () => {
    mocks.assignment.mockResolvedValue(null);
    const response = await submit({});
    expect(response.status).toBe(403);
    expect(mocks.assignment).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job", userId: "cleaner", removedAt: null } }));
    expect(mocks.template).not.toHaveBeenCalled(); expectNoWrites();
  });

  it.each(["locked", "inactive", "missing", "additionals-only"])("preserves the %s pre-write gate", async (gate) => {
    if (gate === "locked") job.status = JobStatus.COMPLETED;
    if (gate === "inactive") mocks.template.mockResolvedValue({ id: "template", isActive: false, schema: baseSchema });
    if (gate === "missing" || gate === "additionals-only") mocks.template.mockResolvedValue(null);
    const response = await submit({ note: "done", uploads: { photo: ["evidence.jpg"] } }, gate === "additionals-only" ? gate : "template");
    expect(response.status).toBe(gate === "locked" ? 400 : 409);
    expectNoWrites();
    if (gate !== "locked") expect((await response.json()).code).toBe("FORM_CHANGED");
  });

  it.each(["arbitrary-active", "old-pin", "override", "global", "wrong-service", "other-job"])("rejects caller template mismatch (%s) before writes for headerless callers", async reason => {
    const own = { id: "server", serviceType: JobType.AIRBNB_TURNOVER, isActive: true, version: 2, schema: baseSchema };
    const other = { ...own, id: "caller", version: 1,
      ...(reason === "wrong-service" ? { serviceType: JobType.DEEP_CLEAN } : {}),
      ...(reason === "other-job" ? { isJobScoped: true } : {}) };
    mocks.templates.mockResolvedValue([other, own]);
    if (reason === "old-pin") job.formTemplateId = "server";
    if (reason === "override") mocks.settings.mockResolvedValue({ propertyFormTemplateOverrides: { property: { AIRBNB_TURNOVER: "server" } } });
    const response = await submit({}, "caller");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "FORM_CHANGED" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expectNoWrites();
  });

  it.each(["missing", "wrong-id"])("rejects %s rework anchor without provisioning", async kind => {
    job.isRework = true; job.reworkAreas = areas;
    mocks.anchor.mockResolvedValue(kind === "missing" ? null : { id: "canonical-anchor", schema: {} });
    const response = await submit({});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "FORM_CHANGED" });
    expect(mocks.anchor).toHaveBeenCalledWith({ where: { serviceType: JobType.AIRBNB_TURNOVER, isActive: false, name: "Rework checklist" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expectNoWrites();
  });
});

it.each(["forms/job/12345678-1234-4123-8123-123456789012/cleaner/photo.jpg", "forms/cleaner/legacy.jpg", "jobs/job/cleaner/legacy.jpg", "forms/job/12345678-1234-4123-8123-123456789012/cleaner/video.mov"])("accepts acknowledged required evidence key %s without falsely reporting missing", async key => {
  mocks.draft.mockResolvedValue({ state: { uploads: { photo: [{ key, kind: key.endsWith(".mov") ? "video" : "image", url: `https://media.invalid/${key}` }] } }, evidenceReceipts: { capture: { key, fieldId: "photo", destination: { type: "formField", fieldId: "photo" }, version: 0 } } });
  const result = await submit({ note: "Work finished", uploads: { photo: [key] } });
  expect(result.status).toBe(200); expect(mocks.create).toHaveBeenCalledOnce();
});
it("still refuses genuinely empty required uploads even when an unrelated server receipt exists", async () => {
  mocks.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "photo.jpg", fieldId: "other" } } });
  const result = await submit({ note: "Done", uploads: {} }); expect(result.status).toBe(400); expect((await result.json()).error).toContain("Missing required uploads"); expectNoWrites();
});


it("rejects fewer distinct photos than the configured minimum before claiming submission", async () => {
  mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, schema: {
    standardSections: false, sections: [{ id: "proof", fields: [{ id: "photos", type: "photo", minPhotos: 2 }] }],
  } });
  const response = await submit({ uploads: { photos: ["same.jpg", "same.jpg"] } });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("at least 2 photos");
  expectNoWrites();
});
it("persists extra payment requests before the submission transaction commits", async () => {
  mocks.pay.mockImplementation(async () => { events.push("pay"); return { id: "pay" }; });
  const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"] } }, "template", {
    draftPayRequestPayload: { title: "Extra clean", type: "FIXED", requestedAmount: 20, cleanerNote: "Oven" },
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect(events.indexOf("pay")).toBeGreaterThan(events.indexOf("snapshot"));
  expect(events.indexOf("pay")).toBeLessThan(events.indexOf("commit"));
});
it("does not acknowledge a submitted clean when its extra payment cannot be persisted", async () => {
  mocks.pay.mockRejectedValue(new Error("Payment write failed"));
  const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"] } }, "template", {
    draftPayRequestPayload: { title: "Extra clean", type: "FIXED", requestedAmount: 20, cleanerNote: "Oven" },
  });
  expect(response.status).toBe(400);
  expect(events).not.toContain("commit");
  expect(mocks.notify).not.toHaveBeenCalled();
});

it.each(["draft", "skipped"])("does not submit a %s job", async state => {
  if (state === "draft") job.internalNotes = serializeJobInternalNotes({ isDraft: true });
  else job.cleanSkipStatus = "SKIPPED";
  const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } });
  expect(response.status).toBe(409);
  expectNoWrites();
});

it("does not duplicate an extra payment repeated in legacy and multi-item payloads", async () => {
  mocks.pay.mockResolvedValue({ id: "pay" });
  const item = { title: "Oven", type: "FIXED", requestedAmount: 20, cleanerNote: "Detail clean" };
  const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } }, "template", {
    draftPayRequestPayload: item, draftPayRequestItems: [item],
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect(mocks.pay).toHaveBeenCalledTimes(1);
  expect(mocks.media.mock.calls[0][0].data[0].label).toBe("Evidence");
});

it("keeps an already-recorded extra request on a reopened form without creating another", async () => {
  mocks.payExisting.mockResolvedValue({ id: "original" });
  const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } }, "template", {
    draftPayRequestPayload: { title: "Oven", requestedAmount: 20 },
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect((await response.json()).payRequestsAlreadyRecorded).toBe(1);
  expect(mocks.pay).not.toHaveBeenCalled();
});

it.each([
  { allowed: false, note: "No plants", proofKeys: ["proof.jpg"], status: 400 },
  { allowed: true, note: "", proofKeys: ["proof.jpg"], status: 400 },
  { allowed: true, note: "No plants", proofKeys: [], requiresPhoto: false, status: 400 },
  { allowed: true, note: "No plants", proofKeys: ["proof.jpg"], status: 200 },
])("only allows admin-enabled not-applicable with reason and required proof (%j)", async example => {
  mocks.tasks.mockResolvedValue([{ id: "task", title: "Plant care", source: "ADMIN", requiresPhoto: example.requiresPhoto ?? true, metadata: { allowNotApplicable: example.allowed } }]);
  mocks.unexpected.mockResolvedValue({ carriedForwardCount: 0 });
  const response = await submit({ note: "Done", uploads: { photo: ["evidence.jpg"] } }, "template", {
    jobTasks: [{ id: "task", decision: "NOT_APPLICABLE", note: example.note, proofKeys: example.proofKeys }],
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(example.status);
  if (example.status === 400) expectNoWrites();
});
it("commits a private damage case once before notifying after submission commit", async () => {
 const item = { title: "Broken mirror", description: "Cracked", area: "Bedroom", severity: "HIGH", estimatedCost: 20, mediaKeys: ["damage.jpg"] };
 mocks.caseCreate.mockImplementation(async () => { events.push("case"); return { id: "case" }; });
 mocks.caseNotify.mockImplementation(async () => { events.push("case-notice"); });
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } }, "template", { draftDamagePayload: item, draftDamageItems: [item] });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.caseCreate).toHaveBeenCalledTimes(1);
 expect(mocks.caseCreate.mock.calls[0][0]).toMatchObject({ clientVisible: false, clientCanReply: false, attachments: [{ uploadedByUserId: "cleaner", s3Key: "damage.jpg" }] });
 expect(mocks.caseCreate.mock.calls[0][1]).toMatchObject({ transaction: expect.any(Object), afterCommit: expect.any(Array) });
 expect(events.indexOf("case")).toBeLessThan(events.indexOf("commit"));
 expect(events.indexOf("case-notice")).toBeGreaterThan(events.indexOf("commit"));
});
it("does not report success or notify when the mandatory damage case fails", async () => {
 mocks.caseCreate.mockRejectedValue(new Error("Case write failed"));
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } }, "template", { draftDamageItems: [{ title: "Broken mirror" }] });
 expect(response.status).toBe(400); expect(events).not.toContain("commit"); expect(mocks.caseNotify).not.toHaveBeenCalled();
});
it.each([false, true])("persists stock followup or explicit correction review with submission (existing=%s)", async existing => {
 (job.property as any).inventoryEnabled = true;
 mocks.stockReceipt.mockResolvedValue(existing ? { key: "existing" } : null);
 const lowStockRows = [{ stockId: "soap-stock", itemId: "soap", onHand: 0 }];
 mocks.unexpected.mockResolvedValue({ lowStockRows });
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] }, inventoryUsage: { soap: 2 } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect((await response.json()).stockCorrectionRequired).toBe(existing ? true : undefined);
 expect(mocks.followupQueue.mock.calls[0][1]).toMatchObject({ propertyId: "property", submissionId: "submission", lowStockRows: existing ? [] : lowStockRows });
 if (existing) expect(mocks.unexpected).not.toHaveBeenCalled();
 else expect(mocks.unexpected).toHaveBeenCalledWith("property", "submission", { soap: 2 }, expect.any(Object));
});
it("closes resolved carry-forward work in both stores inside the submission transaction", async () => {
 mocks.resolveIssue.mockImplementation(async () => { events.push("resolve-issue"); return { count: 1 }; });
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] }, carryForward: { resolvedTaskIds: ["task"], hasNew: false } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.resolveIssue.mock.calls[0][0].where.job).toEqual({ propertyId: "property" });
 expect(mocks.resolveTask.mock.calls[0][0]).toMatchObject({ where: { jobId: "job", source: "CARRY_FORWARD", executionStatus: "OPEN" }, data: { executionStatus: "COMPLETED" } });
 expect(events.indexOf("resolve-issue")).toBeLessThan(events.indexOf("commit"));
});
it("queues clock-adjustment approval only alongside the submitted clean", async () => {
 job.scheduledDate = new Date("2026-10-03");
 mocks.timeLog.mockResolvedValue({ id: "clock", startedAt: new Date(Date.now() - 10 * 60_000) });
 mocks.office.mockResolvedValue([{ id: "admin" }]);
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } }, "template", { clockAdjustmentRequest: { requestedDurationM: 30, reason: "Missed clock in" } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.clockApproval).toHaveBeenCalledTimes(1);
 expect(mocks.officeNotice.mock.calls[0][0].data[0]).toMatchObject({ subject: "Clock adjustment approval needed", externalId: "mobile-outbox:pending:approvals" });
});
it("queues a jobs-category reclean notice after a rework submission commits", async () => {
 job.isRework = true; mocks.office.mockResolvedValue([{ id: "reviewer" }]);
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.officeNotice.mock.calls.at(-1)?.[0].data[0]).toMatchObject({ subject: "Reclean submitted — ready to review", externalId: "mobile-outbox:pending:jobs" });
});
it("refuses not-applicable when task metadata does not grant an exemption", async () => {
 mocks.tasks.mockResolvedValue([{ id: "task", title: "Required task", source: "ADMIN", metadata: null }]);
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } }, "template", { jobTasks: [{ id: "task", decision: "NOT_APPLICABLE", note: "No access", proofKeys: ["proof.jpg"] }] });
 expect(response.status).toBe(400); expectNoWrites();
});
it("keeps a readable fallback label for evidence keys outside named form fields", async () => {
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"], extra_detail: ["extra.jpg"] } });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.media.mock.calls[0][0].data.find((row: any) => row.s3Key === "extra.jpg").label).toBe("extra detail");
});
it("labels legacy admin-requested proof by the office task title and preserves completion", async () => {
 job.internalNotes = serializeJobInternalNotes({ specialRequestTasks: [{ id: "legacy-task", title: "Clean balcony rail", description: "Wipe railing", requiresPhoto: true, requiresNote: true }] });
 const proofFieldId = "__admin_requested_task_legacy-task_photo";
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"], [proofFieldId]: ["balcony.jpg"] }, __adminRequestedTasks: [{ id: "legacy-task", completed: true, note: "Rail cleaned" }] });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 const media = mocks.media.mock.calls[0][0].data.find((row: any) => row.s3Key === "balcony.jpg");
 expect(media.label).toBe("Clean balcony rail — proof");
 expect(mocks.create.mock.calls[0][0].data.data.__adminRequestedTasks[0]).toMatchObject({ id: "legacy-task", completed: true, note: "Rail cleaned" });
});


describe("truthful device submission compatibility", () => {
  const devices = [{ id: "ring", type: "checkbox", label: "Ring camera charged?", required: true }, { id: "minut", type: "checkbox", label: "Minut charged?", required: true }];
  function useDevices(propertyName = "P4") {
    job.property = { name: propertyName, laundryEnabled: false, inventoryEnabled: false };
    mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, version: 1,
      schema: { ...baseSchema, sections: [...baseSchema.sections, { id: "devices", title: "Devices", fields: devices }] } });
  }
  it("allows P3 submission with removed Ring and honestly not-checked Minut; preserves answers and evidence", async () => {
    useDevices("JacksonP3");
    const data = { note: "Done", uploads: { photo: ["proof.jpg"] }, ring: false,
      minut: { deviceStatus: "NOT_CHECKED", reason: "Owner did not check today." }, signature: "retained-signature" };
    const response = await submit(data);
    expect(response.status).toBe(200);
    const saved = mocks.create.mock.calls[0][0].data.data;
    expect(saved).toMatchObject(data);
    const fields = saved.__templateSchema.sections.flatMap((section: any) => section.fields);
    expect(fields.some((field: any) => field.id === "ring")).toBe(false);
    expect(fields.some((field: any) => field.id === "minut")).toBe(true);
    expect(fields.some((field: any) => field.type === "instruction" && field.label === "Ring camera removed from P3")).toBe(true);
  });
  it("does not exempt another property from recording Ring's actual outcome", async () => {
    useDevices();
    const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] }, minut: true });
    expect(response.status).toBe(400); expectNoWrites();
  });
  it.each(["NEEDS_ATTENTION", "NOT_APPLICABLE", "NOT_CHECKED"])("stores %s and its reason without converting it to true", async deviceStatus => {
    useDevices();
    const ring = { deviceStatus, reason: "Actual observation from cleaner." };
    const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] }, ring, minut: true });
    expect(response.status).toBe(200);
    expect(mocks.create.mock.calls[0][0].data.data.ring).toEqual(ring);
  });
  it("rejects an exception with no reason before any submission writes", async () => {
    useDevices();
    const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] }, ring: true, minut: { deviceStatus: "NOT_CHECKED", reason: " " } });
    expect(response.status).toBe(400); expectNoWrites();
  });
});

it("records work completion and missing photo evidence separately without inventing an upload", async () => {
 mocks.unexpected.mockResolvedValue({ carriedForwardCount: 0 });
 mocks.tasks.mockResolvedValue([{ id: "care", title: "Inspect curtain", source: "ADMIN", requiresPhoto: true, requiresNote: true, metadata: { kind: "PROPERTY_CARE" } }]);
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } }, "template", { jobTasks: [{ id: "care", decision: "COMPLETED", note: "Inspection performed", proofKeys: [], missingPhotoReason: "Camera failed after inspection" }] });
 expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
 expect(mocks.create.mock.calls[0][0].data.data.__jobTasks[0]).toMatchObject({ decision: "COMPLETED", proofKeys: [], missingPhotoReason: "Camera failed after inspection" });
});

it("rejects evidence from another job without submitting or modifying records", async () => {
  const response = await submit({ uploads: { photo: ["forms/another-job/capture/cleaner/photo.jpg"] } });
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "FOREIGN_DRAFT_REFERENCE" }); expectNoWrites();
});

it("submits a later form without stopping the clock again", async () => {
 job.status = JobStatus.PAUSED; job.formPendingAfterClockOut = true;
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } });
 expect(response.status).toBe(200);
 expect((await response.json()).clockOut).toBeNull();
 expect(mocks.closeClock).not.toHaveBeenCalled();
 for (const [args] of mocks.claim.mock.calls) {
   expect(args.data).not.toHaveProperty("gpsCheckOutAt");
   expect(args.data).not.toHaveProperty("gpsCheckOutLat");
 }
});
it.each([1, 0])("only returns a GPS clock receipt when this submit closes the clock (count %s)", async (count) => {
 mocks.timeLog.mockResolvedValue({ id: "clock", startedAt: new Date(Date.now() - 600_000) });
 mocks.closeClock.mockResolvedValue({ count });
 const response = await submit({ note: "Done", uploads: { photo: ["proof.jpg"] } });
 expect(response.status).toBe(200);
 const body = await response.json();
 expect(mocks.closeClock.mock.calls[0][0].where).toEqual({ id: "clock", stoppedAt: null });
 if (count) expect(body.clockOut).toMatchObject({ timeLogId: "clock" });
 else expect(body.clockOut).toBeNull();
});
