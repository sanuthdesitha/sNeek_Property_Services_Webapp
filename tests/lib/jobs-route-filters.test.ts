// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { GET } from "@/app/api/jobs/route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), count: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { job: { count: mocks.count, findMany: mocks.find } } }));

const request = (query = "") => GET(new NextRequest(`http://localhost/api/jobs?${query}`));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner", role: Role.ADMIN } });
  mocks.count.mockResolvedValue(51);
  mocks.find.mockResolvedValue([]);
});

describe("Jobs server refinements", () => {
  it.each(["America/Los_Angeles", "Australia/Sydney", "UTC"])("keeps date-only export bounds fixed in server timezone %s", async timezone => {
    const previous = process.env.TZ; process.env.TZ = timezone;
    try {
      await request("paginated=1&limit=5000&dateFrom=2026-09-09&dateTo=2026-09-09");
      const bounds = mocks.find.mock.calls[0][0].where.scheduledDate;
      expect(bounds).toEqual({ gte: new Date("2026-09-09T00:00:00.000Z"), lt: new Date("2026-09-10T00:00:00.000Z") });
      expect(new Date("2026-09-09T00:00:00Z") >= bounds.gte).toBe(true);
      expect(new Date("2026-09-10T00:00:00Z") < bounds.lt).toBe(false);
      expect(mocks.count.mock.calls[0][0].where.scheduledDate).toEqual(bounds);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("uses the following UTC day across daylight-saving and year boundaries", async () => {
    await request("paginated=1&dateFrom=2026-10-03&dateTo=2026-10-04");
    expect(mocks.find.mock.calls[0][0].where.scheduledDate).toEqual({ gte: new Date("2026-10-03T00:00:00Z"), lt: new Date("2026-10-05T00:00:00Z") });
    await request("paginated=1&dateTo=2026-12-31");
    expect(mocks.find.mock.calls[1][0].where.scheduledDate).toEqual({ lt: new Date("2027-01-01T00:00:00Z") });
  });
  it.each([Role.ADMIN, Role.OPS_MANAGER])("uses identical full-dataset filters for %s count, page and export", async role => {
    mocks.session.mockResolvedValue({ user: { id: "owner", role } });
    const query = "search=Harbour&invoiced=yes&status=COMPLETED&clientId=client-1&propertyId=property-1&cleanerId=cleaner-1&paginated=1";
    const job = { id: "match-51", jobNumber: "JOB-51", internalNotes: null, fixedPrice: 120,
      property: { name: "Harbour", client: { name: "Client" } }, assignments: [],
      qaAssignments: [{ id: "qa-1" }], _count: { formSubmissions: 2 } };
    mocks.find.mockResolvedValue([job]);
    const response = await request(`${query}&page=2`);
    const countWhere = mocks.count.mock.calls[0][0].where;
    const pageArgs = mocks.find.mock.calls[0][0];
    expect(pageArgs.where).toBe(countWhere);
    expect(pageArgs).toMatchObject({ skip: 50, take: 50 });
    expect(countWhere).toMatchObject({ status: "COMPLETED", propertyId: "property-1",
      property: { clientId: "client-1" }, assignments: { some: { userId: "cleaner-1", removedAt: null } },
      AND: [{ OR: [{ status: "INVOICED" }, { invoiceLines: { some: {} } }] }] });
    const text = { contains: "Harbour", mode: "insensitive" };
    expect(countWhere.OR).toEqual([
      { jobNumber: text }, { property: { name: text } }, { property: { suburb: text } },
      { property: { client: { name: text } } },
      { assignments: { some: { removedAt: null, user: { name: text } } } },
    ]);
    expect(await response.json()).toEqual({ jobs: [job], pagination: {
      page: 2, limit: 50, totalCount: 51, totalPages: 2, hasMore: false,
    } });
    await request(`${query}&limit=5000`);
    expect(mocks.find.mock.calls[1][0]).toMatchObject({ where: countWhere, skip: 0, take: 5000 });
    expect(mocks.count.mock.calls[1][0].where).toEqual(countWhere);
    expect(pageArgs.include.assignments).toEqual({ where: { removedAt: null },
      include: { user: { select: { id: true, name: true } } } });
    expect(pageArgs.include.property.select.client).toEqual({ select: { id: true, name: true, email: true } });
    expect(pageArgs.include).not.toHaveProperty("invoiceLines");
    expect(mocks.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER]);
  });

  it("requires both no invoice lines and a non-invoiced status for no, preserving explicit status", async () => {
    await request("paginated=1&invoiced=no&status=INVOICED&search=Bay&cleanerId=unassigned");
    expect(mocks.count.mock.calls[0][0].where).toMatchObject({ status: "INVOICED",
      assignments: { none: { removedAt: null } },
      AND: [{ status: { not: "INVOICED" }, invoiceLines: { none: {} } }],
    });
  });

  it.each(["", "all", "unknown"])("does not add invoice constraints for %s", async invoiced => {
    await request(`paginated=1&invoiced=${invoiced}&search=%20%20`);
    expect(mocks.count.mock.calls[0][0].where).toEqual({});
  });

  it("bounds and trims search and escapes LIKE metacharacters", async () => {
    await request(`paginated=1&search=${encodeURIComponent("x".repeat(201))}`);
    expect(mocks.count.mock.calls[0][0].where.OR[0].jobNumber.contains).toBe("x".repeat(200));
    await request(`paginated=1&search=${encodeURIComponent("  50%_\\  ")}`);
    expect(mocks.count.mock.calls[1][0].where.OR[0].jobNumber).toEqual({ contains: "50\\%\\_\\\\", mode: "insensitive" });
  });

  it.each(["other-cleaner", "unassigned"])("keeps CLEANER scope with hostile cleanerId=%s and refinements", async cleanerId => {
    mocks.session.mockResolvedValue({ user: { id: "self", role: Role.CLEANER } });
    const response = await request(`paginated=1&statusGroup=active&cleanerId=${cleanerId}&search=Other&invoiced=yes`);
    expect(await response.json()).toEqual([]);
    expect(mocks.count).not.toHaveBeenCalled();
    const args = mocks.find.mock.calls[0][0];
    expect(args.where).toMatchObject({ assignments: { some: { userId: "self", removedAt: null } },
      cleanSkipStatus: { not: "SKIPPED" }, status: { notIn: ["COMPLETED", "INVOICED"] } });
    expect(args.where.OR).toHaveLength(5);
    expect(args.where.AND).toHaveLength(1);
    expect(args).not.toHaveProperty("take");
  });

  it("preserves the legacy array contract and applies the same refinements", async () => {
    const response = await request("search=Bay&invoiced=no");
    expect(await response.json()).toEqual([]);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.find.mock.calls[0][0].where).toHaveProperty("AND");
    expect(mocks.find.mock.calls[0][0].where).toHaveProperty("OR");
  });

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("does not query on %s", async (message, status) => {
    mocks.session.mockRejectedValue(new Error(String(message)));
    expect((await request("paginated=1&search=Bay&invoiced=yes")).status).toBe(status);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
