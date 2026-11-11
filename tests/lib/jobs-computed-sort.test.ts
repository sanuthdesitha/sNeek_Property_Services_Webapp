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
import { COMPUTED_SORT_CAP, cleanerOrderSql } from "@/lib/jobs/list-computed-sort";
import { compareComputedRows, guestInSortValue, type ComputedSortRow } from "@/lib/jobs/list-computed-order";

type Row = { id: string; scheduledDate: Date; jobType: string; propertyId: string; fixedPrice: number | null; internalNotes: string | null; sameDayCheckin: boolean };

const day = (n: number) => new Date(Date.UTC(2026, 10, 10 + n));
const notes = (checkinAtLocal?: string, stayStartDate?: string) => JSON.stringify({ version: 1, reservationContext: { checkinAtLocal, stayStartDate } });
let dataset: Row[] = [];

/** findMany: a select (the computed pass) returns the whole set; an id page returns those rows. */
function installFind() {
  m.find.mockImplementation(async (args: { select?: unknown; where: { id?: { in: string[] } } }) => {
    if (args.select) return dataset;
    const ids = args.where.id?.in ?? [];
    // Deliberately shuffled: the route must restore the computed order.
    return dataset.filter((row) => ids.includes(row.id)).reverse().map((row) => ({ ...row, property: null, assignments: [] }));
  });
}

const request = (query: string) => GET(new NextRequest(`http://localhost/api/jobs?paginated=1&${query}`));
const ids = async (query: string) => ((await (await request(query)).json()).jobs as Array<{ id: string }>).map((job) => job.id);

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "owner", role: Role.ADMIN } });
  m.rates.mockResolvedValue([]);
  m.priceBook.mockResolvedValue([]);
  dataset = [];
});

describe("computed sort order (pure)", () => {
  const row = (id: string, value: number | null, dayMs = 0): ComputedSortRow => ({ id, value, dayMs });
  it("puts rows without a value last in both directions and ties on day then id", () => {
    const rows = [row("b", null), row("a", 10), row("c", 30), row("d", 10, 5), row("e", null, -1)];
    expect([...rows].sort((x, y) => compareComputedRows(x, y, "asc")).map((r) => r.id)).toEqual(["a", "d", "c", "e", "b"]);
    expect([...rows].sort((x, y) => compareComputedRows(x, y, "desc")).map((r) => r.id)).toEqual(["c", "a", "d", "e", "b"]);
  });
  it("reads Guest in from the check-in instant, else the stay's Sydney day, else nothing", () => {
    expect(guestInSortValue({ checkinAt: "2026-11-12T04:00:00.000Z", stayStartDate: "2026-11-12" })).toBe(Date.parse("2026-11-12T04:00:00.000Z"));
    expect(guestInSortValue({ checkinAt: null, stayStartDate: "2026-11-12" })).toBe(Date.parse("2026-11-11T13:00:00.000Z"));
    expect(guestInSortValue({ checkinAt: "garbage", stayStartDate: null })).toBeNull();
  });
});

describe("Charge sort over the whole filtered set", () => {
  beforeEach(() => {
    // 12 jobs: fixed prices 10..120 (shuffled), two with no rate at all.
    const prices = [70, null, 30, 120, 10, 90, null, 50, 110, 20, 100, 40];
    dataset = prices.map((price, index) => ({
      id: `j${String(index).padStart(2, "0")}`, scheduledDate: day(index % 3), jobType: "DEEP_CLEAN", propertyId: "p1",
      fixedPrice: price, internalNotes: null, sameDayCheckin: false,
    }));
    m.count.mockResolvedValue(dataset.length);
    installFind();
  });

  it("pages continue each other in charge order, with no-rate jobs last", async () => {
    const first = await ids("sort=charge&dir=asc&page=1&limit=10");
    const second = await ids("sort=charge&dir=asc&page=2&limit=10");
    expect([...first, ...second]).toEqual(["j04", "j09", "j02", "j11", "j07", "j00", "j05", "j10", "j08", "j03", "j06", "j01"]);
    const desc = [...await ids("sort=charge&dir=desc&page=1&limit=10"), ...await ids("sort=charge&dir=desc&page=2&limit=10")];
    expect(desc.slice(0, 2)).toEqual(["j03", "j08"]);
    expect(desc.slice(-2)).toEqual(["j06", "j01"]);
  });

  it("still shows No rate on a job that sorted last", async () => {
    const body = await (await request("sort=charge&page=2&limit=10&extras=1")).json();
    expect(body.jobs.map((job: { charge: { missing: boolean } }) => job.charge.missing)).toEqual([true, true]);
    expect(body.pagination).toMatchObject({ totalCount: 12, page: 2 });
  });

  it("refuses a filtered set above the cap with 400 and reads no rows", async () => {
    m.count.mockResolvedValue(COMPUTED_SORT_CAP + 1);
    const response = await request("sort=charge");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("SORT_SET_TOO_LARGE");
    expect(body.error).toMatch(/Narrow the date or filters/);
    expect(m.find).not.toHaveBeenCalled();
  });
});

describe("Guest in sort", () => {
  it("orders by arriving check-in with jobs that have none last, across pages", async () => {
    dataset = Array.from({ length: 11 }, (_, index) => ({
      id: `g${String(index).padStart(2, "0")}`, scheduledDate: day(0), jobType: "AIRBNB_TURNOVER", propertyId: "p1", fixedPrice: null,
      internalNotes: index % 4 === 0 ? null : notes(`2026-11-12T0${9 - (index % 9)}:00:00.000Z`), sameDayCheckin: false,
    }));
    m.count.mockResolvedValue(dataset.length);
    installFind();
    const all = [...await ids("sort=guestIn&page=1&limit=10"), ...await ids("sort=guestIn&page=2&limit=10")];
    expect(all.slice(-3)).toEqual(["g00", "g04", "g08"]);
    expect(new Set(all).size).toBe(11);
  });
});

describe("Cleaner sort", () => {
  it("orders the whole filtered id set in SQL, unassigned first, and keeps that order", async () => {
    dataset = ["a", "b", "c"].map((id) => ({ id, scheduledDate: day(0), jobType: "DEEP_CLEAN", propertyId: "p", fixedPrice: null, internalNotes: null, sameDayCheckin: false }));
    m.count.mockResolvedValue(3);
    installFind();
    m.queryRaw.mockResolvedValue([{ id: "c" }, { id: "a" }]);
    expect(await ids("sort=cleaner&dir=desc&page=1&limit=10")).toEqual(["c", "a"]);
    const sql = m.queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain(`ORDER BY (c.sort_name IS NULL) DESC, c.sort_name DESC`);
    expect(sql.sql).toContain(`a."isPrimary" DESC, a."assignedAt" ASC`);
    expect(sql.values).toEqual([["a", "b", "c"], 0, 10]);
  });

  it("builds the page offset from the requested page", () => {
    const sql = cleanerOrderSql(["x"], "asc", 50, 50);
    expect(sql.sql).toContain("c.sort_name ASC");
    expect(sql.values).toEqual([["x"], 50, 50]);
  });
});

describe("Board lanes with a computed sort", () => {
  it("orders each lane by the computed sort before cutting it", async () => {
    dataset = [
      { id: "cheap", scheduledDate: day(0), jobType: "DEEP_CLEAN", propertyId: "p", fixedPrice: 10, internalNotes: null, sameDayCheckin: false },
      { id: "dear", scheduledDate: day(0), jobType: "DEEP_CLEAN", propertyId: "p", fixedPrice: 99, internalNotes: null, sameDayCheckin: false },
    ];
    m.groupBy.mockResolvedValue([{ status: "UNASSIGNED", _count: { _all: 2 } }]);
    installFind();
    const body = await (await BOARD(new NextRequest("http://localhost/api/admin/jobs/board?sort=charge&dir=desc"))).json();
    expect(body.lanes[0].jobs.map((job: { id: string }) => job.id)).toEqual(["dear", "cheap"]);
  });
});
