// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobType } from "@prisma/client";
const mocks = vi.hoisted(() => ({ templates: vi.fn(), anchor: vi.fn(), create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { formTemplate: { findMany: mocks.templates, findFirst: mocks.anchor, create: mocks.create } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(() => { throw Error("Unexpected settings access"); }) }));
vi.mock("@/lib/qa/annotation-composite", () => ({ compositeAnnotated: vi.fn(() => { throw Error("Unexpected provider access"); }) }));
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { assembleJobForm } from "@/lib/forms/assemble-job-form";
import { buildReworkFormSchema } from "@/lib/qa/rework-jobs";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";

const extra = [{ id: "oven", label: "<b>Oven</b>" }];
const schema = { standardSections: false, sections: [{ id: "kitchen", fields: [
  { id: "proof", type: "upload", required: true, references: [{ storageKey: "ref.jpg", kind: "image" }] },
] }] };
const row = (id: string, patch = {}) => ({ id, name: id, isActive: true, version: 1, serviceType: JobType.AIRBNB_TURNOVER, schema, ...patch });
const job = { jobType: JobType.AIRBNB_TURNOVER, propertyId: "property", isRework: false, internalNotes: serializeJobInternalNotes({ additionals: extra }) };
const areas = [{ id: "kitchen", label: "Kitchen", photoKeys: ["qa.jpg"] }];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.templates.mockResolvedValue([row("global")]);
  mocks.anchor.mockResolvedValue(row("anchor", { isActive: false }));
  mocks.create.mockResolvedValue(row("created", { isActive: false }));
});

describe("resolveEffectiveJobForm", () => {
  it.each(["pin", "override", "global"])("selects %s with existing priority, metadata and assembly", async mode => {
    mocks.templates.mockResolvedValue([row("global", { version: 2 }), row("pin", { isJobScoped: true }), row("override")]);
    const settings = { propertyFormTemplateOverrides: { property: { AIRBNB_TURNOVER: mode === "global" ? "missing" : "override" } } };
    const result = await resolveEffectiveJobForm({ ...job, formTemplateId: mode === "pin" ? "pin" : null }, settings);
    expect(result.persistedTemplateId).toBe(mode);
    expect(result.submittable).toBe(true);
    expect(result.templateSource).toBe({ pin: "job_pin", override: "property_override", global: "global_latest" }[mode]);
    expect(result.configuredPropertyTemplateId).toBe(mode === "global" ? "missing" : "override");
    expect(result.template?.schema).toEqual(assembleJobForm(schema, extra));
    expect(mocks.templates).toHaveBeenCalledWith({ where: { serviceType: job.jobType, isActive: true } });
    expect(mocks.anchor).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("falls back from unusable pin/override, excluding other properties and job-scoped rows", async () => {
    mocks.templates.mockResolvedValue([row("archived", { isActive: false }), row("scoped", { version: 99 }),
      row("job-scoped", { version: 100, isJobScoped: true }), row("global")]);
    const result = await resolveEffectiveJobForm({ ...job, formTemplateId: "archived" }, {
      propertyFormTemplateOverrides: { property: { AIRBNB_TURNOVER: "missing" }, elsewhere: { AIRBNB_TURNOVER: "scoped" } },
    });
    expect(result.persistedTemplateId).toBe("global");
  });

  it("resolves global ties independently of DB row order", async () => {
    const rows = [row("b"), row("a")];
    mocks.templates.mockResolvedValue(rows);
    const first = await resolveEffectiveJobForm(job, {});
    mocks.templates.mockResolvedValue([...rows].reverse());
    expect(await resolveEffectiveJobForm(job, {})).toEqual(first);
    expect(first.persistedTemplateId).toBe("a");
  });

  it.each([false, true])("keeps missing-template display separate from FK availability (additionals=%s)", async additionals => {
    mocks.templates.mockResolvedValue([]);
    const result = await resolveEffectiveJobForm({ ...job, internalNotes: additionals ? job.internalNotes : null }, {});
    expect(result).toMatchObject({ submittable: false, persistedTemplateId: null, templateSource: "global_latest" });
    expect(result.template?.id ?? null).toBe(additionals ? "additionals-only" : null);
    if (additionals) expect(result.template?.schema).toEqual(assembleJobForm(null, extra));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([false, true])("read and submit assemble identical generated rework schemas (categorized=%s)", async categorized => {
    const input = { ...job, isRework: true, reworkAreas: areas,
      internalNotes: serializeJobInternalNotes({ additionals: extra, reworkCategorized: categorized }) };
    const read = await resolveEffectiveJobForm(input, {}, { provisionReworkAnchor: true });
    const submit = await resolveEffectiveJobForm(input, {});
    expect(read).toEqual(submit);
    expect(read.persistedTemplateId).toBe("anchor");
    expect(read.template?.schema).toEqual(assembleJobForm(buildReworkFormSchema(areas, { categorized }), extra));
    expect(mocks.anchor).toHaveBeenCalledWith({ where: { serviceType: job.jobType, name: "Rework checklist", isActive: false },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("never provisions a missing anchor in submit mode; explicit read mode preserves provisioning", async () => {
    mocks.anchor.mockResolvedValue(null);
    const input = { ...job, isRework: true, reworkAreas: areas };
    expect(await resolveEffectiveJobForm(input, {})).toMatchObject({ submittable: false, persistedTemplateId: null, template: null });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(await resolveEffectiveJobForm(input, {}, { provisionReworkAnchor: true })).toMatchObject({ submittable: true, persistedTemplateId: "created" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("empty rework areas retain normal template resolution without hidden anchor access", async () => {
    expect((await resolveEffectiveJobForm({ ...job, isRework: true, reworkAreas: [] }, {})).persistedTemplateId).toBe("global");
    expect(mocks.anchor).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
