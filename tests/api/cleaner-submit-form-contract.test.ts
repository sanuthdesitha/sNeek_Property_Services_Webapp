// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { JobStatus, JobType, Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), assignment: vi.fn(), job: vi.fn(), template: vi.fn(), timeLog: vi.fn(),
  claim: vi.fn(), transaction: vi.fn(), create: vi.fn(), media: vi.fn(), update: vi.fn(),
  settings: vi.fn(), continuation: vi.fn(), tasks: vi.fn(),
  report: vi.fn(), notify: vi.fn(), lifecycle: vi.fn(), automations: vi.fn(), qa: vi.fn(),
  clear: vi.fn(), lowStock: vi.fn(), unexpected: vi.fn(), templates: vi.fn(), anchor: vi.fn(), provision: vi.fn(),
  draft: vi.fn(), lock: vi.fn(), query: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  jobAssignment: { findFirst: mocks.assignment },
  job: { findUnique: mocks.job, updateMany: mocks.claim },
  formTemplate: { findUnique: mocks.template, findMany: mocks.templates, findFirst: mocks.anchor, create: mocks.provision },
  timeLog: { findFirst: mocks.timeLog },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: mocks.continuation }));
vi.mock("@/lib/job-tasks/service", () => ({ listCleanerJobTasks: mocks.tasks, applyCleanerJobTaskUpdates: mocks.unexpected }));
vi.mock("@/lib/inventory/stock", () => ({ deductStockFromSubmission: mocks.unexpected, fireLowStockSideEffects: mocks.lowStock }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: mocks.report }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://media.invalid/${key}` }));
vi.mock("@/lib/cases/service", () => ({ createCase: mocks.unexpected }));
vi.mock("@/lib/cases/notifications", () => ({ notifyCaseCreated: mocks.unexpected }));
vi.mock("@/lib/laundry/cleaner-status", () => ({ applyCleanerLaundryStatusUpdate: mocks.unexpected }));
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
  expect(mocks.transaction).not.toHaveBeenCalled();
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
  mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER } });
  mocks.assignment.mockResolvedValue({ id: "assignment" });
  mocks.job.mockImplementation(async () => job);
  mocks.template.mockResolvedValue({ id: "template", isActive: true, serviceType: JobType.AIRBNB_TURNOVER, version: 1, schema: baseSchema });
  mocks.templates.mockImplementation(async () => { const value = await mocks.template(); return value ? [value] : []; });
  mocks.anchor.mockResolvedValue({ id: "template", isActive: false, serviceType: JobType.AIRBNB_TURNOVER, schema: {} });
  mocks.timeLog.mockResolvedValue(null);
  mocks.settings.mockResolvedValue({
    noPhotoExemptCleanerIds: [],
    accountability: { requiredChecklistTicksBlockSubmit: true },
    finalCheckup: { enabled: false },
  });
  mocks.continuation.mockResolvedValue([]); mocks.tasks.mockResolvedValue([]);
  mocks.claim.mockImplementation(async () => { events.push("claim"); return { count: 1 }; });
  mocks.draft.mockResolvedValue(null); mocks.query.mockResolvedValue([]);
  mocks.lock.mockImplementation(async (_job, callback) => callback({ $queryRaw: mocks.query, job: { updateMany: mocks.claim } }));
  mocks.create.mockImplementation(async () => { events.push("snapshot"); return { id: "submission" }; });
  mocks.media.mockResolvedValue({ count: 1 }); mocks.update.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    events.push("transaction");
    const result = await callback({
      formSubmission: { create: mocks.create }, submissionMedia: { createMany: mocks.media },
      job: { update: mocks.update },
    });
    events.push("commit"); return result;
  });
  for (const fn of [mocks.report, mocks.notify, mocks.lifecycle, mocks.automations, mocks.qa, mocks.clear, mocks.lowStock]) fn.mockResolvedValue(undefined);
  mocks.unexpected.mockImplementation(() => { throw new Error("Unexpected side-effect boundary"); });
});

describe("real cleaner submit form contract", () => {
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
    expect(mocks.query).toHaveBeenCalledOnce(); expect(mocks.lock).toHaveBeenCalledOnce();
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
    expect(await response.json()).toEqual({ ok: true, submissionId: "submission" });
    expect(events).toEqual(["claim", "transaction", "snapshot", "commit"]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
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
    expect(mocks.clear).toHaveBeenCalledWith("job");
    expect(mocks.unexpected).not.toHaveBeenCalled();
    expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("preserves active assignment authorization before template access", async () => {
    mocks.assignment.mockResolvedValue(null);
    const response = await submit({});
    expect(response.status).toBe(403);
    expect(mocks.assignment).toHaveBeenCalledWith({ where: { jobId: "job", userId: "cleaner", removedAt: null } });
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
