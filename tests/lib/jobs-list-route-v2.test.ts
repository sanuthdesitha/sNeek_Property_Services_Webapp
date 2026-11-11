// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), count: vi.fn(), find: vi.fn(), groupBy: vi.fn(), queryRaw: vi.fn(), rates: vi.fn(), priceBook: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({
  db: {
    job: { count: m.count, findMany: m.find, groupBy: m.groupBy },
    $queryRaw: m.queryRaw,
    propertyClientRate: { findMany: m.rates },
    priceBook: { findMany: m.priceBook },
  },
}));
import { GET } from "@/app/api/jobs/route";
import { GET as BOARD } from "@/app/api/admin/jobs/board/route";
import { redactJobForCleaner } from "@/lib/jobs/cleaner-redaction";

const request = (query = "") => GET(new NextRequest(`http://localhost/api/jobs?${query}`));
const job = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1", jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", propertyId: "p-1", fixedPrice: null, sameDayCheckin: true,
  internalNotes: JSON.stringify({ version: 1, reservationContext: { checkinAtLocal: "2026-11-12T04:00:00.000Z", stayStartDate: "2026-11-12" } }),
  property: { name: "Bondi", client: { id: "c", name: "Client", email: "office@client.test" } },
  assignments: [{ userId: "cleaner-2", payRate: 40, user: { id: "cleaner-2", name: "Other", email: "o@x.test" } }],
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "owner", role: Role.ADMIN } });
  m.count.mockResolvedValue(1);
  m.find.mockResolvedValue([]);
  m.rates.mockResolvedValue([]);
  m.priceBook.mockResolvedValue([]);
});

describe("paginated Jobs list contract", () => {
  // Cleaner, Guest in and Charge became sortable on purpose (Wave A, computed
  // over the whole filtered set: tests/lib/jobs-computed-sort.test.ts).
  it.each(["scheduled_desc", "price", "guest", "cleaner_name"])("refuses unknown sort %s with 400 before reading jobs", async (sort) => {
    const response = await request(`paginated=1&sort=${sort}`);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Cannot sort by");
    expect(m.find).not.toHaveBeenCalled();
    expect(m.count).not.toHaveBeenCalled();
  });

  it("refuses an unknown direction with 400", async () => {
    expect((await request("paginated=1&sort=when&dir=up")).status).toBe(400);
    expect(m.find).not.toHaveBeenCalled();
  });

  it.each([
    ["when&dir=desc", [{ scheduledDate: "desc" }, { priorityBucket: "asc" }, { dueTime: "desc" }, { startTime: "desc" }]],
    ["latest", [{ scheduledDate: "desc" }, { priorityBucket: "asc" }, { dueTime: "desc" }, { startTime: "desc" }]],
    ["soonest", [{ scheduledDate: "asc" }, { priorityBucket: "asc" }, { dueTime: "asc" }, { startTime: "asc" }]],
    ["client&dir=asc", [{ property: { client: { name: "asc" } } }, { scheduledDate: "asc" }, { id: "asc" }]],
    ["type&dir=desc", [{ jobType: "desc" }, { scheduledDate: "asc" }, { id: "asc" }]],
    ["status", [{ status: "asc" }, { scheduledDate: "asc" }, { id: "asc" }]],
    ["created", [{ createdAt: "desc" }, { id: "asc" }]],
  ])("orders by the allow-listed sort %s", async (sort, orderBy) => {
    await request(`paginated=1&sort=${sort}`);
    expect(m.find.mock.calls[0][0].orderBy).toEqual(orderBy);
  });

  it("filters on any list of the eleven statuses and refuses an unknown one", async () => {
    await request("paginated=1&status=UNASSIGNED,WAITING_CONTINUATION_APPROVAL,EN_ROUTE");
    expect(m.count.mock.calls[0][0].where.status).toEqual({ in: ["UNASSIGNED", "WAITING_CONTINUATION_APPROVAL", "EN_ROUTE"] });
    await request("paginated=1&status=PAUSED");
    expect(m.count.mock.calls[1][0].where.status).toBe("PAUSED");
    const refused = await request("paginated=1&status=PAUSED,CANCELLED");
    expect(refused.status).toBe(400);
    expect(m.count).toHaveBeenCalledTimes(2);
  });

  it("limits to selected ids for a selection export and bounds the list", async () => {
    await request("paginated=1&limit=5000&ids=job-1,job-2,job-1");
    expect(m.count.mock.calls[0][0].where.id).toEqual({ in: ["job-1", "job-2"] });
    const tooMany = Array.from({ length: 501 }, (_, index) => `job-${index}`).join(",");
    expect((await request(`paginated=1&ids=${tooMany}`)).status).toBe(400);
    expect((await request("paginated=1&ids=bad%20id")).status).toBe(400);
  });

  it("adds view-tab counts only when asked, from one grouped query", async () => {
    m.queryRaw.mockResolvedValue([{ today: 1, "needs-cleaner": 2, week: 3, "awaiting-qa": 4, "not-invoiced": 5, all: 6 }]);
    const plain = await (await request("paginated=1")).json();
    expect(plain).not.toHaveProperty("counts");
    expect(m.queryRaw).not.toHaveBeenCalled();
    const withCounts = await (await request("paginated=1&counts=1")).json();
    expect(withCounts.counts).toEqual({ today: 1, "needs-cleaner": 2, week: 3, "awaiting-qa": 4, "not-invoiced": 5, all: 6 });
    expect(m.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("adds the arriving guest and a charge that stays null when no rate exists", async () => {
    m.find.mockResolvedValue([job(), job({ id: "job-2", fixedPrice: 165, sameDayCheckin: false, internalNotes: null })]);
    const body = await (await request("paginated=1&extras=1")).json();
    expect(body.jobs[0].guestIn).toEqual({ checkinAt: "2026-11-12T04:00:00.000Z", stayStartDate: "2026-11-12", sameDay: true });
    expect(body.jobs[0].charge).toEqual({ amount: null, source: "MISSING", missing: true });
    expect(body.jobs[1].charge).toEqual({ amount: 165, source: "FIXED_JOB", missing: false });
    expect(body.jobs[1].guestIn).toEqual({ checkinAt: null, stayStartDate: null, sameDay: false });
    // Without extras the rows are exactly what the list has always returned.
    m.find.mockResolvedValue([job()]);
    const plain = await (await request("paginated=1")).json();
    expect(plain.jobs[0]).not.toHaveProperty("charge");
    expect(plain.jobs[0]).not.toHaveProperty("guestIn");
  });
});

describe("legacy Jobs list contract", () => {
  it("keeps the non-paginated array shape, lenient sort and the raw single status", async () => {
    m.find.mockResolvedValue([job()]);
    const response = await request("sort=nonsense&status=COMPLETED");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).not.toHaveProperty("charge");
    expect(m.find.mock.calls[0][0].where.status).toBe("COMPLETED");
    expect(m.find.mock.calls[0][0].orderBy).toEqual([{ scheduledDate: "asc" }, { priorityBucket: "asc" }, { dueTime: "asc" }, { startTime: "asc" }]);
    expect(m.count).not.toHaveBeenCalled();
  });

  it("keeps the completed-group default order for older callers", async () => {
    await request("statusGroup=completed&paginated=1");
    expect(m.find.mock.calls[0][0].orderBy[0]).toEqual({ scheduledDate: "desc" });
  });

  it("redacts exactly as before for a cleaner, whatever the new parameters say", async () => {
    m.session.mockResolvedValue({ user: { id: "cleaner-1", role: Role.CLEANER } });
    const row = job({ fixedPrice: 120, internalNotes: null });
    m.find.mockResolvedValue([row]);
    const body = await (await request("paginated=1&extras=1&counts=1&sort=cleaner")).json();
    expect(body).toEqual([JSON.parse(JSON.stringify(redactJobForCleaner(row, "cleaner-1")))]);
    expect(body[0]).not.toHaveProperty("fixedPrice");
    expect(body[0]).not.toHaveProperty("charge");
    expect(body[0].assignments[0]).not.toHaveProperty("payRate");
    expect(m.queryRaw).not.toHaveBeenCalled();
  });
});

describe("Jobs board lanes", () => {
  it("counts every lane from one grouped query over the list filters", async () => {
    m.groupBy.mockResolvedValue([
      { status: "UNASSIGNED", _count: { _all: 40 } }, { status: "OFFERED", _count: { _all: 2 } }, { status: "COMPLETED", _count: { _all: 7 } },
    ]);
    m.find.mockResolvedValue([]);
    const response = await BOARD(new NextRequest("http://localhost/api/admin/jobs/board?status=UNASSIGNED,OFFERED,COMPLETED&search=Bay&sort=when&dir=asc"));
    const body = await response.json();
    expect(body.lanes.map((lane: { id: string; count: number }) => [lane.id, lane.count])).toEqual([["unassigned", 42], ["scheduled", 0], ["inprogress", 0], ["done", 7]]);
    expect(body.total).toBe(49);
    expect(m.groupBy).toHaveBeenCalledTimes(1);
    const where = m.groupBy.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["UNASSIGNED", "OFFERED", "COMPLETED"] });
    expect(where.OR).toHaveLength(5);
    // Empty lanes are not read; non-empty lanes read their first rows only.
    expect(m.find).toHaveBeenCalledTimes(2);
    expect(m.find.mock.calls[0][0]).toMatchObject({ take: 25, where: { AND: [where, { status: { in: ["UNASSIGNED", "OFFERED"] } }] } });
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });

  it("refuses an unknown sort and keeps auth failures", async () => {
    expect((await BOARD(new NextRequest("http://localhost/api/admin/jobs/board?sort=price"))).status).toBe(400);
    m.session.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await BOARD(new NextRequest("http://localhost/api/admin/jobs/board"))).status).toBe(403);
    expect(m.groupBy).not.toHaveBeenCalled();
  });
});
