// @vitest-environment node
// Wave E: the classic Forms page's Submissions tab, ported. Server paging and
// sorting through list-query; the submission view's detail; edits keep the
// original as history (before/after audit), internal fields cannot change,
// removing media never deletes the stored original (tombstone, restorable),
// added media must pass the upload-ownership rule.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  role: vi.fn(), count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), templates: vi.fn(), raw: vi.fn(),
  update: vi.fn(), mediaDelete: vi.fn(), mediaCreate: vi.fn(), mediaCreateMany: vi.fn(), audit: vi.fn(), auditFind: vi.fn(),
  deleteObject: vi.fn(), report: vi.fn(), foreign: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/s3", () => ({ deleteObject: m.deleteObject, publicUrl: (key: string) => `https://files.invalid/${key}` }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: m.report }));
vi.mock("@/lib/uploads/ownership-server", () => ({ findForeignUploadKeys: m.foreign }));
vi.mock("@/lib/db", () => {
  const tx = { formSubmission: { update: m.update }, submissionMedia: { deleteMany: m.mediaDelete, create: m.mediaCreate, createMany: m.mediaCreateMany }, auditLog: { create: m.audit } };
  return { db: {
    formSubmission: { count: m.count, findMany: m.findMany, findUnique: m.findUnique },
    formTemplate: { findMany: m.templates },
    auditLog: { findMany: m.auditFind },
    $queryRaw: m.raw,
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  } };
});

import { GET as LIST } from "@/app/api/admin/form-submissions/route";
import { GET as DETAIL, PATCH } from "@/app/api/admin/form-submissions/[id]/route";

const admin = { user: { id: "admin-1", role: Role.ADMIN } };
const listRow = {
  id: "s1", createdAt: new Date("2026-11-10T01:00:00Z"), jobId: "j1", laundryReady: true,
  data: { __validationWarnings: [{ fieldId: "temp", message: "Out of range", rule: "range" }, { fieldId: "email", message: "Bad", rule: "email" }] },
  template: { id: "t1", name: "Turnover", serviceType: "AIRBNB_TURNOVER" },
  submittedBy: { id: "c1", name: "Jane", email: "jane@example.invalid" },
  job: { id: "j1", jobNumber: "J-1", scheduledDate: new Date("2026-11-10T00:00:00Z"), status: "COMPLETED", property: { id: "p1", name: "Bondi", suburb: "Bondi" } },
  _count: { media: 4 },
};
const media = { id: "m1", submissionId: "s1", fieldId: "oven", mediaType: "PHOTO", url: "https://files.invalid/forms/c1/a.jpg", s3Key: "forms/c1/a.jpg", originalUrl: "https://files.invalid/forms/c1/orig.jpg", originalS3Key: "forms/c1/orig.jpg", annotatedUrl: null, annotatedS3Key: null, annotationData: null, sizeBytes: 100, mimeType: "image/jpeg", label: null, createdAt: new Date("2026-11-10T01:00:00Z") };
const existing = () => ({ id: "s1", jobId: "j1", data: { bench: true, notes: "ok", __templateSchema: { sections: [] } }, laundryReady: true, laundryOutcome: null, bagLocation: "Laundry", media: [media] });
const list = (search: string) => LIST(new Request(`http://localhost/api/admin/form-submissions?${search}`) as never);
const patch = (body: Record<string, unknown>) => PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }) as never, { params: { id: "s1" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue(admin);
  m.count.mockResolvedValue(53);
  m.findMany.mockResolvedValue([listRow]);
  m.templates.mockResolvedValue([{ id: "t1", name: "Turnover" }]);
  m.findUnique.mockResolvedValue(existing());
  m.foreign.mockResolvedValue([]);
  m.report.mockResolvedValue(undefined);
  m.auditFind.mockResolvedValue([]);
});

describe("list", () => {
  it("pages and sorts on the server and returns summaries with real counts", async () => {
    const body = await (await list("paginated=1&page=3&pageSize=25&sort=property&dir=asc")).json();
    expect(body).toMatchObject({ total: 53, page: 3, pageCount: 3, sort: "property", dir: "asc", forms: [{ id: "t1" }] });
    expect(body.rows[0]).toMatchObject({ id: "s1", warningCount: 2, mediaCount: 4, cleaner: { name: "Jane" }, property: { name: "Bondi" }, job: { jobNumber: "J-1" } });
    expect(body.rows[0]).not.toHaveProperty("data");
    const args = m.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 50, take: 25 });
    expect(args.orderBy[0]).toEqual({ job: { property: { name: "asc" } } });
  });

  it.each([
    ["submitted", { createdAt: "desc" }],
    ["form", { template: { name: "desc" } }],
    ["job", { job: { scheduledDate: "desc" } }],
    ["cleaner", { submittedBy: { name: { sort: "desc", nulls: "last" } } }],
  ])("sorts by %s", async (sort, order) => {
    await list(`paginated=1&sort=${sort}&dir=desc`);
    expect(m.findMany.mock.calls[0][0].orderBy[0]).toEqual(order);
  });

  it("refuses an unknown sort and filters by form, cleaner, dates and warnings", async () => {
    expect((await list("paginated=1&sort=data")).status).toBe(400);
    m.raw.mockResolvedValue([{ id: "s1" }]);
    await list("paginated=1&templateId=t1&cleanerId=c1&from=2026-11-01&to=2026-11-30&warnings=1");
    const where = m.findMany.mock.calls[0][0].where.AND;
    expect(where).toEqual(expect.arrayContaining([{ templateId: "t1" }, { submittedById: "c1" }, { id: { in: ["s1"] } }]));
    expect(where.find((part: Record<string, unknown>) => "createdAt" in part).createdAt.gte.toISOString()).toBe("2026-10-31T13:00:00.000Z");
  });

  it("keeps the old unpaged shape for older callers", async () => {
    m.findMany.mockResolvedValue([{ id: "legacy" }]);
    expect(await (await list("")).json()).toEqual([{ id: "legacy" }]);
  });
});

describe("edit", () => {
  it("keeps the original answers as history (before/after) and only writes what changed", async () => {
    m.findUnique.mockResolvedValueOnce(existing()).mockResolvedValueOnce({ id: "s1" });
    expect((await patch({ data: { bench: false, notes: "ok", __templateSchema: { sections: [] } }, bagLocation: "Front door" })).status).toBe(200);
    expect(m.update.mock.calls[0][0].data.data).toMatchObject({ bench: false, notes: "ok" });
    expect(m.audit.mock.calls[0][0].data).toMatchObject({
      action: "FORM_SUBMISSION_EDITED", entity: "FormSubmission", entityId: "s1",
      before: { answers: { bench: true }, laundry: { bagLocation: "Laundry" } },
      after: { answers: { bench: false }, laundry: { bagLocation: "Front door" }, changedKeys: ["bench"] },
    });
  });

  it("refuses changes to internal fields", async () => {
    const response = await patch({ data: { __templateSchema: { sections: [{ id: "x" }] } } });
    expect(response.status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("removes media from the submission without deleting the stored original, and can restore it", async () => {
    m.findUnique.mockResolvedValueOnce(existing()).mockResolvedValueOnce({ id: "s1" });
    expect((await patch({ deleteMediaIds: ["m1"] })).status).toBe(200);
    expect(m.deleteObject).not.toHaveBeenCalled();
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ action: "FORM_SUBMISSION_MEDIA_REMOVED", after: { originalKept: true, media: { id: "m1", s3Key: "forms/c1/a.jpg", originalS3Key: "forms/c1/orig.jpg" } } });
    expect(m.mediaDelete).toHaveBeenCalledWith({ where: { submissionId: "s1", id: { in: ["m1"] } } });

    const tombstone = m.audit.mock.calls[0][0].data.after;
    m.findUnique.mockResolvedValueOnce({ ...existing(), media: [] }).mockResolvedValueOnce({ id: "s1" });
    m.auditFind.mockResolvedValue([{ after: JSON.parse(JSON.stringify(tombstone)) }]);
    expect((await patch({ restoreMediaAuditIds: ["audit-1"] })).status).toBe(200);
    expect(m.mediaCreate.mock.calls[0][0].data).toMatchObject({ id: "m1", submissionId: "s1", s3Key: "forms/c1/a.jpg", originalS3Key: "forms/c1/orig.jpg" });
    expect(m.audit.mock.calls.at(-1)?.[0].data).toMatchObject({ action: "FORM_SUBMISSION_MEDIA_RESTORED", after: { mediaIds: ["m1"] } });
  });

  it("adds media only when the upload belongs to the caller, a cleaner on the job or the office", async () => {
    m.foreign.mockResolvedValueOnce(["submission-edits/someone/x.jpg"]);
    expect((await patch({ addMediaUrls: [{ url: "https://files.invalid/x.jpg", s3Key: "submission-edits/someone/x.jpg", fieldId: "admin_edit" }] })).status).toBe(403);
    expect(m.mediaCreateMany).not.toHaveBeenCalled();
    m.findUnique.mockResolvedValueOnce(existing()).mockResolvedValueOnce({ id: "s1" });
    expect((await patch({ addMediaUrls: [{ url: "javascript:alert(1)", s3Key: "submission-edits/admin-1/y.jpg", fieldId: "admin_edit", mimeType: "image/jpeg" }] })).status).toBe(200);
    expect(m.foreign).toHaveBeenLastCalledWith({ keys: ["submission-edits/admin-1/y.jpg"], callerId: "admin-1", jobId: "j1" });
    expect(m.mediaCreateMany.mock.calls[0][0].data[0]).toMatchObject({ url: "https://files.invalid/submission-edits/admin-1/y.jpg", mediaType: "PHOTO" });
    expect(m.audit.mock.calls.at(-1)?.[0].data.action).toBe("FORM_SUBMISSION_MEDIA_ADDED");
  });
});

describe("detail", () => {
  it("reads the questions from the stored form and lists history and restorable media", async () => {
    m.findUnique.mockResolvedValue({
      id: "s1", createdAt: new Date("2026-11-10T01:00:00Z"), jobId: "j1", laundryReady: null, laundryOutcome: null, bagLocation: null,
      data: { __templateSchema: { sections: [{ title: "Kitchen", fields: [{ id: "stock", type: "stock_count", label: "Paper", unit: "rolls", stockItemName: "Toilet paper" }] }] }, stock: { itemId: "i", count: 6 } },
      template: { id: "t1", name: "Turnover", serviceType: "AIRBNB_TURNOVER", schema: { sections: [] } },
      submittedBy: { name: "Jane", email: null }, media: [],
      job: { jobNumber: "J-1", scheduledDate: new Date("2026-11-10T00:00:00Z"), status: "COMPLETED", property: { id: "p1", name: "Bondi", suburb: null } },
    });
    m.auditFind.mockResolvedValue([{ id: "audit-1", action: "FORM_SUBMISSION_MEDIA_REMOVED", createdAt: new Date("2026-11-11T01:00:00Z"), before: null, after: { media: { id: "m1", fieldId: "oven" } }, user: { name: "Ana", email: null } }]);
    const body = await (await DETAIL(new Request("http://localhost/x") as never, { params: { id: "s1" } })).json();
    expect(body).toMatchObject({ fieldsFromSnapshot: true, fields: [{ id: "stock", type: "stock_count", sectionTitle: "Kitchen", unit: "rolls" }], removedMedia: [{ auditId: "audit-1", media: { id: "m1" } }], history: [{ actor: "Ana" }] });
  });
});
