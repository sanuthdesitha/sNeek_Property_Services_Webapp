/**
 * Activity log (2026-11): plain sentences, the actual person apart from the
 * person they were testing as, field-by-field changes, list-query paging
 * (unknown sort refused), category filters, old links, and a capped CSV that
 * only administrators can export.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), findMany: vi.fn(), count: vi.fn(), users: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { findMany: m.findMany, count: m.count }, user: { findMany: m.users } } }));

import { activitySentence, fieldChanges, toActivityRow } from "@/lib/admin/activity-format";
import { activityWhere, ACTIVITY_CSV_LIMIT, listActivity, parseActivityFilters, parseActivityQuery } from "@/lib/admin/activity";
import { GET as exportCsv } from "@/app/api/admin/activity/export/route";

const ROW = {
  id: "a1", createdAt: new Date("2026-11-12T00:00:00Z"), action: "UPDATE_ACCESS", entity: "User", entityId: "u2", jobId: null, ipAddress: null,
  before: { laundry: "off" }, after: { laundry: "read", impersonatedBy: "admin1" },
  user: { name: "Chloe Martin", email: "c@x", role: "OPS_MANAGER" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
  m.findMany.mockResolvedValue([ROW]);
  m.count.mockResolvedValue(1);
  m.users.mockResolvedValue([{ id: "admin1", name: "Ravi Mehta", email: "r@x", role: "ADMIN" }]);
});

describe("activity format", () => {
  it("credits the real person and shows who they were testing as separately", () => {
    const view = toActivityRow(ROW, new Map([["admin1", { name: "Ravi Mehta", email: "r@x", role: "ADMIN" }]]));
    expect(view.actual).toEqual({ name: "Ravi Mehta", role: "admin" });
    expect(view.testingAs).toEqual({ name: "Chloe Martin", role: "ops manager" });
    expect(view.changes).toEqual([{ field: "laundry", before: "off", after: "read" }]);
  });

  it("never credits the viewed person when the real account is unknown", () => {
    const view = toActivityRow(ROW, new Map());
    expect(view.actual.name).toBe("Unknown account (testing)");
    expect(view.testingAs?.name).toBe("Chloe Martin");
  });

  it("writes sentences and hides secrets from the diff", () => {
    expect(activitySentence("UPDATE_JOB_STATUS", "Job", null)).toBe("Updated job status");
    expect(activitySentence("APPROVAL_DECISION", "CleanerPayAdjustment", { decision: "APPROVED", label: "Parking", subjectName: "Marco" })).toBe("Approved Parking for Marco");
    expect(fieldChanges({ passwordHash: "a" }, { passwordHash: "b" })).toEqual([]);
  });
});

describe("activity list", () => {
  it("keeps old links meaning everything and refuses unknown sort or category", () => {
    expect(parseActivityFilters(new URLSearchParams("entity=Job")).period).toBe("all");
    expect(parseActivityFilters(new URLSearchParams("")).period).toBe("7");
    expect(parseActivityFilters(new URLSearchParams("user=chloe")).person).toBe("chloe");
    expect(() => parseActivityQuery(new URLSearchParams("sort=who"))).toThrow(/Cannot sort/);
    expect(() => parseActivityFilters(new URLSearchParams("category=nope"))).toThrow(/Unknown category/);
  });

  it("filters testing-as rows and money record types", () => {
    const testing = JSON.stringify(activityWhere(parseActivityFilters(new URLSearchParams("category=testing&period=all"))));
    expect(testing).toContain("impersonatedBy");
    const money = JSON.stringify(activityWhere(parseActivityFilters(new URLSearchParams("category=money&period=all"))));
    expect(money).toContain("ClientInvoice");
  });

  it("pages with real totals and counts per category", async () => {
    m.count.mockResolvedValue(3);
    const page = await listActivity(parseActivityFilters(new URLSearchParams("period=all")), parseActivityQuery(new URLSearchParams("page=1&pageSize=50")));
    expect(page.total).toBe(3);
    expect(page.counts.all).toBe(3);
    expect(page.rows[0].actual.name).toBe("Ravi Mehta");
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 50 });
  });
});

describe("activity CSV export", () => {
  it("is administrators only", async () => {
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await exportCsv(new NextRequest("http://localhost/api/admin/activity/export"))).status).toBe(403);
  });

  it("is capped and says so", async () => {
    m.count.mockResolvedValue(ACTIVITY_CSV_LIMIT + 5);
    const response = await exportCsv(new NextRequest("http://localhost/api/admin/activity/export?period=all"));
    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(text).toContain("Ravi Mehta,Chloe Martin");
    expect(text).toContain(`Only the newest ${ACTIVITY_CSV_LIMIT}`);
    expect(m.findMany.mock.calls.at(-1)?.[0]).toMatchObject({ take: ACTIVITY_CSV_LIMIT });
  });
});
