// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  role: "ADMIN" as string,
  writes: vi.fn(),
  templateFind: vi.fn(),
  draftRows: vi.fn(),
  appSetting: vi.fn(),
  qaFind: vi.fn(),
  qaCount: vi.fn(),
  submissions: vi.fn(),
  audit: vi.fn(),
  auditCount: vi.fn(),
  qaUpdate: vi.fn(),
  qaDelete: vi.fn(),
  qaCreate: vi.fn(),
  qaFirst: vi.fn(),
}));

function readOnlyDb() {
  const write = (name: string) => (...args: unknown[]) => {
    m.writes(name, ...args);
    throw new Error(`unexpected write ${name}`);
  };
  return {
    formTemplate: { findUnique: m.templateFind, findUniqueOrThrow: m.templateFind, update: write("formTemplate.update"), updateMany: write("formTemplate.updateMany"), create: write("formTemplate.create") },
    formTemplateVersion: { findMany: m.draftRows, create: write("version.create"), updateMany: write("version.updateMany"), findUniqueOrThrow: m.draftRows },
    formSubmission: { create: write("formSubmission.create") },
    submissionMedia: { createMany: write("submissionMedia.createMany") },
    timeLog: { create: write("timeLog.create"), update: write("timeLog.update") },
    notification: { create: write("notification.create"), createMany: write("notification.createMany") },
    auditLog: { create: m.audit, count: m.auditCount, groupBy: vi.fn(async () => []) },
    appSetting: { findUnique: m.appSetting, upsert: m.appSetting },
    qaFormTemplate: { findUnique: m.qaFind, update: m.qaUpdate, delete: m.qaDelete, create: m.qaCreate, findFirst: m.qaFirst },
    qaFormSubmission: { count: m.submissions },
  };
}

vi.mock("@/lib/db", () => {
  const client = readOnlyDb();
  return { db: { ...client, $transaction: async (run: (tx: unknown) => unknown) => run(client) } };
});
vi.mock("@/lib/auth/session", () => ({
  requireRole: async (roles: string[]) => {
    if (!m.role) throw new Error("UNAUTHORIZED");
    if (!roles.includes(m.role)) throw new Error("FORBIDDEN");
    return { user: { id: "admin", role: m.role } };
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountability: { requiredChecklistTicksBlockSubmit: false } }) }));

import { POST as testRun } from "@/app/api/admin/form-templates/[id]/test-run/route";
import { PATCH as legacyPatch } from "@/app/api/admin/form-templates/[id]/route";
import { GET as listBlocks, POST as createBlock } from "@/app/api/admin/form-templates/blocks/route";
import { DELETE as deleteQa, PATCH as patchQa } from "@/app/api/admin/qa/templates/[id]/route";
import { POST as duplicateQa } from "@/app/api/admin/qa/templates/[id]/duplicate/route";
import { findQaTemplateConflicts } from "@/lib/qa/template-conflicts";
import { filterAndSortQaTemplates } from "@/components/v2/admin/qa/qa-template-list";
import { legacyFormEditRedirect, legacyNewFormRedirect } from "@/lib/admin/legacy-forms-redirects";

const json = (body: unknown, method = "POST") => new NextRequest("http://localhost/api", { method, body: JSON.stringify(body) });
const params = { params: { id: "t" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.role = "ADMIN";
  m.templateFind.mockResolvedValue({ id: "t", name: "Form", isActive: true, updatedAt: new Date("2026-11-01T00:00:00Z"), schema: { sections: [] } });
  m.draftRows.mockResolvedValue([]);
});

describe("Test as cleaner", () => {
  it("validates sample answers on the server and writes nothing", async () => {
    const schema = { standardSections: false, sections: [{ id: "s", title: "S", fields: [{ id: "q", type: "text", label: "Name", required: true }, { id: "e", type: "email", label: "Email" }] }] };
    const response = await testRun(json({ schema, answers: { e: "not-an-email" } }), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.problems.map((p: { fieldId: string; level: string }) => [p.fieldId, p.level])).toEqual([["q", "blocking"], ["e", "warning"]]);
    expect(m.writes).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.appSetting).not.toHaveBeenCalled();
  });
  it("is ADMIN only", async () => {
    m.role = "OPS_MANAGER";
    expect((await testRun(json({ schema: { sections: [] } }), params)).status).toBe(403);
  });
});

describe("legacy PATCH", () => {
  it("routes schema edits to the draft (strict checks) instead of the live form", async () => {
    const refused = await legacyPatch(json({ schema: { sections: [{ id: "s", fields: [{ id: "f", type: "table", label: "X" }] }] } }, "PATCH"), params);
    expect(refused.status).toBe(422);
    expect(m.writes).not.toHaveBeenCalledWith("formTemplate.update", expect.anything());
  });
  it("keeps a metadata-only edit on the row and audits it", async () => {
    const update = vi.fn(async () => ({ id: "t", name: "Renamed" }));
    const { db } = await import("@/lib/db");
    (db.formTemplate as unknown as { update: typeof update }).update = update;
    m.audit.mockResolvedValue({});
    const response = await legacyPatch(json({ name: "Renamed" }, "PATCH"), params);
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: "t" }, data: { name: "Renamed" } });
    expect(m.audit.mock.calls[0][0].data.action).toBe("FORM_TEMPLATE_METADATA");
  });
});

describe("saved blocks", () => {
  it("stores copies of the questions (rules outside the block dropped) in one AppSetting row", async () => {
    m.appSetting.mockResolvedValueOnce(null).mockResolvedValueOnce({});
    const response = await createBlock(json({ name: "Oven", fields: [{ id: "a", type: "photo", label: "Oven", conditional: { fieldId: "outside", value: true } }] }));
    expect(response.status).toBe(201);
    const upsert = m.appSetting.mock.calls[1][0];
    expect(upsert.where).toEqual({ key: "formBuilder.savedBlocks" });
    const stored = upsert.create.value.blocks[0];
    expect(stored.fields[0].id).not.toBe("a");
    expect(stored.fields[0].conditional).toBeUndefined();
  });
  it("lists for OPS but refuses OPS writes", async () => {
    m.role = "OPS_MANAGER";
    m.appSetting.mockResolvedValue({ value: { blocks: [{ id: "b", name: "B", fields: [{ id: "x", type: "text", label: "X" }], createdAt: "2026-11-01" }, { broken: true }] } });
    const list = await (await listBlocks()).json();
    expect(list.blocks).toHaveLength(1);
    expect((await createBlock(json({ name: "N", fields: [{ id: "x", type: "text", label: "X" }] }))).status).toBe(403);
  });
});

describe("QA templates", () => {
  const template = { id: "q", name: "QA", serviceType: "AIRBNB_TURNOVER", propertyId: null, version: 3, isActive: true, schema: { sections: [] }, sourceFormTemplateId: null };
  beforeEach(() => {
    m.qaFind.mockResolvedValue(template);
    m.qaUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...template, ...data }));
    m.audit.mockResolvedValue({});
  });

  it("records a revision for a content save without bumping the resolving version", async () => {
    m.auditCount.mockResolvedValue(2);
    const response = await patchQa(json({ templateSchema: { sections: [{ id: "x" }] } }, "PATCH"), { params: { id: "q" } });
    const body = await response.json();
    expect(body.revision).toBe(3);
    expect(body.version).toBe(3);
    expect(m.audit.mock.calls.map((c) => c[0].data.action)).toEqual(["QA_TEMPLATE_REVISION", "QA_TEMPLATE_UPDATE"]);
    expect(m.audit.mock.calls[0][0].data.before.schema).toEqual({ sections: [] });
  });
  it("does not count switching on/off as a revision", async () => {
    const body = await (await patchQa(json({ isActive: false }, "PATCH"), { params: { id: "q" } })).json();
    expect(body.revision).toBeNull();
  });
  it("deactivates instead of deleting a template inspections used, and deletes an unused one", async () => {
    m.submissions.mockResolvedValueOnce(4);
    expect(await (await deleteQa(json({}, "DELETE"), { params: { id: "q" } })).json()).toEqual({ outcome: "deactivated", inspections: 4 });
    expect(m.qaDelete).not.toHaveBeenCalled();
    expect(m.qaUpdate).toHaveBeenCalledWith({ where: { id: "q" }, data: { isActive: false } });
    m.submissions.mockResolvedValueOnce(0);
    expect(await (await deleteQa(json({}, "DELETE"), { params: { id: "q" } })).json()).toEqual({ outcome: "deleted" });
    expect(m.qaDelete).toHaveBeenCalledWith({ where: { id: "q" } });
  });
  it("duplicates as an inactive copy in the same scope", async () => {
    m.qaFirst.mockResolvedValue({ version: 5 });
    m.qaCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "copy", ...data }));
    const response = await duplicateQa(json({}), { params: { id: "q" } });
    expect(response.status).toBe(201);
    expect(m.qaCreate.mock.calls[0][0].data).toMatchObject({ name: "QA (copy)", isActive: false, version: 6, propertyId: null });
  });
  it("refuses QA writes to operations managers", async () => {
    m.role = "OPS_MANAGER";
    expect((await deleteQa(json({}, "DELETE"), { params: { id: "q" } })).status).toBe(403);
    expect((await duplicateQa(json({}), { params: { id: "q" } })).status).toBe(403);
  });
  it("warns about overlapping active templates and names the one that resolves", () => {
    const rows = [
      { id: "a", name: "A", serviceType: "DEEP_CLEAN", propertyId: null, version: 2, isActive: true },
      { id: "b", name: "B", serviceType: "DEEP_CLEAN", propertyId: null, version: 5, isActive: true },
      { id: "c", name: "C", serviceType: "DEEP_CLEAN", propertyId: "p1", version: 1, isActive: true },
      { id: "d", name: "D", serviceType: "DEEP_CLEAN", propertyId: null, version: 9, isActive: false },
      { id: "e", name: "E", serviceType: "WINDOW_CLEAN", propertyId: null, version: 1, isActive: true },
      { id: "f", name: "F", serviceType: "WINDOW_CLEAN", propertyId: null, version: 1, isActive: true },
    ];
    expect(findQaTemplateConflicts(rows)).toEqual([
      { serviceType: "DEEP_CLEAN", propertyId: null, templateIds: ["b", "a"], resolvesToId: "b" },
      { serviceType: "WINDOW_CLEAN", propertyId: null, templateIds: ["e", "f"], resolvesToId: null },
    ]);
  });
  it("filters by job type and scope and sorts", () => {
    const rows = [
      { name: "Z", serviceType: "DEEP_CLEAN", propertyId: "p", version: 1, property: { name: "Beach" } },
      { name: "A", serviceType: "AIRBNB_TURNOVER", propertyId: null, version: 4 },
      { name: "M", serviceType: "DEEP_CLEAN", propertyId: null, version: 2 },
    ];
    expect(filterAndSortQaTemplates(rows, { jobType: "DEEP_CLEAN", scope: "all", sort: "name" }).map((r) => r.name)).toEqual(["M", "Z"]);
    expect(filterAndSortQaTemplates(rows, { jobType: "all", scope: "global", sort: "version" }).map((r) => r.name)).toEqual(["A", "M"]);
  });
});

describe("legacy /admin/forms redirects", () => {
  it("keeps the template id and query", () => {
    expect(legacyFormEditRedirect("abc 1", { tab: "x", multi: ["1", "2"] })).toBe("/v2/admin/forms/abc%201/edit?tab=x&multi=1&multi=2");
    expect(legacyNewFormRedirect({ kind: "CUSTOM" })).toBe("/v2/admin/forms/new?kind=CUSTOM");
    expect(legacyNewFormRedirect()).toBe("/v2/admin/forms/new");
  });
});
