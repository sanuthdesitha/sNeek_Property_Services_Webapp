// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: "ADMIN" as string,
  list: vi.fn(),
  bulk: vi.fn(),
  saveDraft: vi.fn(),
  restore: vi.fn(),
  publish: vi.fn(),
  groups: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  db: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn(() => { throw new Error("database touched"); }) }) }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireRole: async (roles: string[]) => {
    if (!m.role) throw new Error("UNAUTHORIZED");
    if (!roles.includes(m.role)) throw new Error("FORBIDDEN");
    return { user: { id: "actor", role: m.role } };
  },
}));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/forms/library-list", async (importOriginal) => ({ ...(await importOriginal<object>()), listFormLibrary: m.list }));
vi.mock("@/lib/forms/template-bulk", () => ({ runBulkTemplateOperation: m.bulk }));
vi.mock("@/lib/forms/template-drafts", () => ({ saveTemplateDraft: m.saveDraft, restoreTemplateVersion: m.restore, readTemplateDraft: vi.fn(), discardTemplateDraft: vi.fn(), templateEditToken: vi.fn() }));
vi.mock("@/lib/forms/template-publish", () => ({ publishFormTemplate: m.publish, archiveFormTemplate: vi.fn(), unarchiveFormTemplate: vi.fn() }));
vi.mock("@/lib/forms/template-groups", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listFormGroups: m.groups.list,
  createFormGroup: m.groups.create,
  updateFormGroup: m.groups.update,
  deleteFormGroup: m.groups.remove,
}));

import { GET as library } from "@/app/api/admin/form-templates/library/route";
import { POST as bulk } from "@/app/api/admin/form-templates/bulk/route";
import { PUT as saveDraft } from "@/app/api/admin/form-templates/[id]/draft/route";
import { POST as restore } from "@/app/api/admin/form-templates/[id]/versions/[versionId]/restore/route";
import { POST as publish } from "@/app/api/admin/form-templates/[id]/publish/route";
import { GET as listGroups, POST as createGroup } from "@/app/api/admin/form-templates/groups/route";
import { PATCH as renameGroup, DELETE as deleteGroup } from "@/app/api/admin/form-templates/groups/[groupId]/route";
import { TemplateServiceError } from "@/lib/forms/template-errors";

const get = (query: string) => library(new NextRequest(`http://localhost/api/admin/form-templates/library${query}`));
const post = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const schema = { sections: [{ id: "s", title: "S", fields: [] }] };
const bulkBody = { templateIds: ["a"], operation: { type: "archive" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.role = "ADMIN";
  m.list.mockResolvedValue({ rows: [], total: 0 });
  m.bulk.mockResolvedValue({ outcomes: [] });
  m.groups.list.mockResolvedValue([]);
});

describe("library list route", () => {
  it("passes validated paging, sort and filters to the service", async () => {
    m.role = "OPS_MANAGER";
    const response = await get("?page=2&pageSize=10&sort=checks&dir=desc&scope=drafts&status=live-draft&usedBy=property&problems=1&q=oven&group=g1&tag=Rework");
    expect(response.status).toBe(200);
    expect(m.list).toHaveBeenCalledWith({
      query: expect.objectContaining({ page: 2, pageSize: 10, skip: 10, take: 10, sort: "checks", dir: "desc" }),
      filters: { scope: "drafts", status: "live-draft", usedBy: "property", problems: true, q: "oven", group: "g1", tag: "Rework" },
    });
  });

  it("refuses unknown sorts, filters and oversized pages instead of ignoring them", async () => {
    for (const query of ["?sort=avg", "?status=published", "?scope=everything", "?pageSize=500"]) {
      expect((await get(query)).status).toBe(400);
    }
    expect(m.list).not.toHaveBeenCalled();
  });

  it.each([["", 401], ["CLEANER", 403]] as const)("denies role %s before reading", async (role, status) => {
    m.role = role;
    expect((await get("")).status).toBe(status);
    expect(m.list).not.toHaveBeenCalled();
  });
});

describe("write routes stay ADMIN only", () => {
  const writes = [
    ["bulk", () => bulk(post(bulkBody))],
    ["save draft", () => saveDraft(new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify({ schema }) }), { params: { id: "t" } })],
    ["restore", () => restore(post({}), { params: { id: "t", versionId: "v" } })],
    ["publish", () => publish(post({ action: "publish" }), { params: { id: "t" } })],
    ["create group", () => createGroup(post({ name: "Deep clean" }))],
    ["rename group", () => renameGroup(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ name: "X" }) }), { params: { groupId: "g" } })],
    ["delete group", () => deleteGroup(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: { groupId: "g" } })],
  ] as const;

  it.each(writes)("forbids OPS_MANAGER to %s before any service call", async (_name, run) => {
    m.role = "OPS_MANAGER";
    expect((await run()).status).toBe(403);
    for (const fn of [m.bulk, m.saveDraft, m.restore, m.publish, m.groups.create, m.groups.update, m.groups.remove]) expect(fn).not.toHaveBeenCalled();
  });

  it("lets OPS_MANAGER read groups, as it reads templates", async () => {
    m.role = "OPS_MANAGER";
    expect((await listGroups()).status).toBe(200);
  });
});

describe("bulk route contract", () => {
  it("caps the number of forms and validates the operation", async () => {
    const tooMany = { templateIds: Array.from({ length: 51 }, (_, i) => `t${i}`), operation: { type: "archive" } };
    expect((await bulk(post(tooMany))).status).toBe(400);
    expect((await bulk(post({ templateIds: ["a"], operation: { type: "delete" } }))).status).toBe(400);
    expect((await bulk(post({ templateIds: ["a"], operation: { type: "edit-question", match: { kind: "fieldId", fieldId: "x" }, edit: { property: "minPhotos", value: 99 } } }))).status).toBe(400);
    expect(m.bulk).not.toHaveBeenCalled();
  });

  it("defaults to applying and passes dry runs through", async () => {
    await bulk(post(bulkBody));
    await bulk(post({ ...bulkBody, dryRun: true }));
    expect(m.bulk.mock.calls.map(([input]) => input.dryRun)).toEqual([false, true]);
    expect(m.bulk.mock.calls[0][0]).toMatchObject({ actorId: "actor", templateIds: ["a"], operation: { type: "archive" } });
  });
});

describe("draft and publish errors", () => {
  it("answers a stale draft save with 409 STALE_TEMPLATE and the current token", async () => {
    m.saveDraft.mockRejectedValue(new TemplateServiceError("STALE_TEMPLATE", "changed", "2026-11-11T00:00:00.000Z"));
    const response = await saveDraft(new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify({ schema, expectedUpdatedAt: "2026-11-10T00:00:00.000Z" }) }), { params: { id: "t" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STALE_TEMPLATE", currentUpdatedAt: "2026-11-11T00:00:00.000Z" });
    expect(m.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ templateId: "t", expectedToken: "2026-11-10T00:00:00.000Z", actorId: "actor" }));
  });

  it("refuses a draft whose structure is invalid before saving", async () => {
    const response = await saveDraft(new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify({ schema: { sections: "no" } }) }), { params: { id: "t" } });
    expect(response.status).toBe(400);
    expect(m.saveDraft).not.toHaveBeenCalled();
  });

  it("restore only replaces an existing draft when asked", async () => {
    m.restore.mockResolvedValue({ draft: { id: "d", note: "Restored from v1" }, token: "tok" });
    await restore(post({}), { params: { id: "t", versionId: "v" } });
    await restore(post({ replaceDraft: true }), { params: { id: "t", versionId: "v" } });
    expect(m.restore.mock.calls.map(([input]) => input.replaceDraft)).toEqual([false, true]);
    m.restore.mockRejectedValueOnce(new TemplateServiceError("DRAFT_EXISTS", "has draft"));
    expect((await restore(post({}), { params: { id: "t", versionId: "v" } })).status).toBe(409);
  });

  it("publish forwards the editor token", async () => {
    m.publish.mockResolvedValue({ template: { id: "t" }, archivedPrevious: 0, publishedVersion: 3, editToken: "tok" });
    const response = await publish(post({ action: "publish", expectedUpdatedAt: "2026-11-10T00:00:00.000Z" }), { params: { id: "t" } });
    expect(response.status).toBe(200);
    expect(m.publish).toHaveBeenCalledWith({ templateId: "t", actorId: "actor", expectedToken: "2026-11-10T00:00:00.000Z" });
  });
});
