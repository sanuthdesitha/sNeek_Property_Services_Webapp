// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  userFindMany: vi.fn(),
  propertyFindMany: vi.fn(),
  payFindMany: vi.fn(),
  audit: vi.fn(),
  settings: vi.fn(),
  rectify: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/db", () => ({
  db: {
    qaIssue: { count: m.count, findMany: m.findMany, groupBy: m.groupBy },
    user: { findMany: m.userFindMany },
    property: { findMany: m.propertyFindMany },
    cleanerPayAdjustment: { findMany: m.payFindMany },
    auditLog: { create: m.audit },
  },
}));
// The bulk action must run the SAME rectify transaction the single PATCH runs.
vi.mock("@/lib/quality/rectify", () => ({ rectifyQaIssue: m.rectify }));

import { GET as listIssues } from "@/app/api/admin/quality/issues/route";
import { POST as bulk } from "@/app/api/admin/quality/issues/bulk/route";
import { GET as exportIssues } from "@/app/api/admin/quality/issues/export/route";
import { GET as options } from "@/app/api/admin/quality/options/route";

const admin = { user: { id: "admin", role: "ADMIN" } };
const inspector = { user: { id: "qa", role: "QA_INSPECTOR" } };
const list = (query: string) => listIssues(new NextRequest(`http://localhost/api/admin/quality/issues?${query}`));
const postBulk = (body: unknown) =>
  bulk(new NextRequest("http://localhost/api/admin/quality/issues/bulk", { method: "POST", body: JSON.stringify(body) }));

function issueRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    category: "kitchen",
    severity: "MINOR",
    description: "Crumbs",
    rectificationStatus: "PENDING",
    rectificationMinutes: null,
    rectificationCost: null,
    rectificationBeforeKeys: null,
    rectificationAfterKeys: null,
    falseConfirmation: "NONE",
    guestReadyImpact: false,
    cleanerMarkedComplete: false,
    qaPhotoKeys: null,
    escalatedAt: null,
    createdAt: new Date("2026-11-05T01:00:00Z"),
    updatedAt: new Date("2026-11-05T01:00:00Z"),
    jobId: "job1",
    propertyId: "prop1",
    cleanerId: "c1",
    raisedById: "qa",
    payAdjustmentId: null,
    job: { id: "job1", jobNumber: "J-1", scheduledDate: new Date("2026-11-05T00:00:00Z"), property: { id: "prop1", name: "Manly Loft", suburb: "Manly" } },
    property: { id: "prop1", name: "Manly Loft", suburb: "Manly" },
    cleaner: { id: "c1", name: "Marco", email: "m@example.test" },
    raisedBy: { id: "qa", name: "Dana", email: "d@example.test" },
    rectifiedBy: null,
    qaReview: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue(admin);
  m.settings.mockResolvedValue({ accountability: { issueCategories: [{ key: "kitchen", label: "Kitchen" }] } });
  m.count.mockResolvedValue(57);
  m.findMany.mockResolvedValue([issueRow("i1")]);
  m.payFindMany.mockResolvedValue([]);
  m.audit.mockResolvedValue({});
});

describe("GET /api/admin/quality/issues", () => {
  it("pages and sorts on the server and returns the real total, not the page length", async () => {
    const response = await list("period=7d&page=3&pageSize=10&sort=severity&dir=desc&cleanerId=c1&openFixes=1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ total: 57, page: 3, pageSize: 10, pageCount: 6, sort: "severity", dir: "desc" });
    expect(body.rows[0]).toMatchObject({ id: "i1", cleaner: { id: "c1", name: "Marco" }, job: { propertyName: "Manly Loft" } });
    const call = m.findMany.mock.calls[0][0];
    expect(call).toMatchObject({ skip: 20, take: 10 });
    expect(call.orderBy[0]).toEqual({ severity: "desc" });
    // count and rows read the same filtered query.
    expect(m.count.mock.calls[0][0].where).toEqual(call.where);
    const and = call.where.AND;
    expect(and).toEqual(expect.arrayContaining([{ cleanerId: "c1" }, { rectificationStatus: { in: ["PENDING", "RETURNED_TO_CLEANER", "NOT_FIXED", "ESCALATED"] } }]));
    expect(and[0].createdAt.gte).toBeInstanceOf(Date);
  });

  it("refuses a sort column outside the allow-list and unknown filter values", async () => {
    expect((await list("sort=description")).status).toBe(400);
    expect((await list("severity=HUGE")).status).toBe(400);
    expect((await list("period=custom&from=2026-11-09&to=2026-11-01")).status).toBe(400);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it("lets a QA inspector read, as the old register did", async () => {
    m.role.mockResolvedValue(inspector);
    expect((await list("")).status).toBe(200);
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER", "QA_INSPECTOR"]);
  });

  it("answers 401/403 from the live guard", async () => {
    m.role.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await list("")).status).toBe(401);
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await list("")).status).toBe(403);
  });
});

describe("POST /api/admin/quality/issues/bulk", () => {
  it("is ADMIN / OPS_MANAGER only: inspectors stay read-only", async () => {
    m.role.mockImplementation(async (roles: string[]) => {
      if (!roles.includes("QA_INSPECTOR")) throw new Error("FORBIDDEN");
      return inspector;
    });
    const response = await postBulk({ action: "mark-fixed", ids: ["i1"], status: "FIXED_BY_MANAGER" });
    expect(response.status).toBe(403);
    expect(m.rectify).not.toHaveBeenCalled();
  });

  it("marks each open issue through the shared rectify action and reports per row", async () => {
    m.findMany.mockResolvedValue([
      issueRow("open"),
      issueRow("same", { rectificationStatus: "FIXED_BY_MANAGER" }),
      issueRow("other", { rectificationStatus: "FIXED_BY_QA" }),
      issueRow("boom", { rectificationStatus: "ESCALATED" }),
    ]);
    m.rectify.mockImplementation(async ({ issue }: { issue: { id: string } }) => {
      if (issue.id === "boom") throw new Error("Database unavailable");
      return issue;
    });
    const response = await postBulk({ action: "mark-fixed", ids: ["open", "same", "other", "missing", "boom", "open"], status: "FIXED_BY_MANAGER" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual([
      { id: "open", ok: true, outcome: "done" },
      { id: "same", ok: false, outcome: "unchanged", reason: "Already fixed by a manager. Nothing changed." },
      { id: "other", ok: false, outcome: "refused", reason: "Already fixed by QA. Open the issue to change how it was fixed." },
      { id: "missing", ok: false, outcome: "refused", reason: "Issue not found." },
      { id: "boom", ok: false, outcome: "refused", reason: "Database unavailable" },
    ]);
    expect(body.summary).toEqual({ done: 1, unchanged: 1, refused: 3 });
    expect(m.rectify).toHaveBeenCalledTimes(2);
    expect(m.rectify.mock.calls[0][0]).toMatchObject({ input: { status: "FIXED_BY_MANAGER" }, actor: { id: "admin", role: "ADMIN" } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "QA_ISSUE_BULK_RECTIFY" }) }));
  });

  it("refuses a malformed body and statuses that are not 'fixed'", async () => {
    expect((await postBulk({ action: "mark-fixed", ids: [], status: "FIXED_BY_MANAGER" })).status).toBe(400);
    expect((await postBulk({ action: "mark-fixed", ids: ["i1"], status: "PENDING" })).status).toBe(400);
    expect(m.rectify).not.toHaveBeenCalled();
  });
});

describe("CSV export and filter options", () => {
  it("exports the same filtered query as CSV and refuses rather than truncating", async () => {
    const ok = await exportIssues(new NextRequest("http://localhost/api/admin/quality/issues/export?period=30d&category=kitchen"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
    const text = await ok.text();
    expect(text.split("\r\n")[0]).toContain("Raised (Sydney)");
    expect(text).toContain("Manly Loft");
    m.count.mockResolvedValue(9000);
    expect((await exportIssues(new NextRequest("http://localhost/api/admin/quality/issues/export"))).status).toBe(400);
  });

  it("reads options from the database, not from loaded rows", async () => {
    m.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      if (by[0] === "cleanerId") return [{ cleanerId: "c1" }];
      if (by[0] === "propertyId") return [{ propertyId: "prop1" }];
      if (by[0] === "raisedById") return [{ raisedById: "qa" }];
      return [{ category: "legacy_key" }];
    });
    m.userFindMany.mockResolvedValue([{ id: "c1", name: "Marco", email: "m" }, { id: "qa", name: "Dana", email: "d" }]);
    m.propertyFindMany.mockResolvedValue([{ id: "prop1", name: "Manly Loft", suburb: "Manly" }]);
    const body = await (await options()).json();
    expect(body.cleaners).toEqual([{ id: "c1", label: "Marco" }]);
    expect(body.inspectors).toEqual([{ id: "qa", label: "Dana" }]);
    expect(body.properties).toEqual([{ id: "prop1", label: "Manly Loft, Manly" }]);
    expect(body.categories).toEqual([
      { id: "kitchen", label: "Kitchen" },
      { id: "legacy_key", label: "legacy_key" },
    ]);
  });
});
