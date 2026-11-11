// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ session: vi.fn(), count: vi.fn(), findMany: vi.fn(), rows: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { qaIssue: { count: m.count, findMany: m.findMany } } }));
vi.mock("@/lib/quality/issue-rows", () => ({ ISSUE_ROW_INCLUDE: {}, toIssueRows: m.rows }));

import { GET } from "@/app/api/admin/qa/issues/route";
import { resolveQualityPeriod, sydneyCreatedAtFilter } from "@/lib/quality/period";

async function createdAtFor(query: string) {
  const response = await GET(new NextRequest(`http://localhost/api/admin/qa/issues?${query}`));
  expect(response.status).toBe(200);
  return m.count.mock.calls[0][0].where.createdAt;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.count.mockResolvedValue(0);
  m.findMany.mockResolvedValue([]);
  m.rows.mockResolvedValue([]);
});

describe("GET /api/admin/qa/issues date filter uses Sydney calendar days", () => {
  it("from starts at Sydney midnight and to covers the whole Sydney day (AEDT)", async () => {
    expect(await createdAtFor("from=2026-11-10&to=2026-11-10")).toEqual({
      gte: new Date("2026-11-09T13:00:00.000Z"),
      lt: new Date("2026-11-10T13:00:00.000Z"),
    });
  });

  it("an issue at 08:00 Sydney on the 11th (21:00Z on the 10th) is not in a to=10th filter", () => {
    const filter = sydneyCreatedAtFilter(null, "2026-11-10")!;
    const lateUtc = new Date("2026-11-10T21:00:00.000Z");
    expect(lateUtc < filter.lt!).toBe(false);
    expect(new Date("2026-11-10T12:59:59.999Z") < filter.lt!).toBe(true);
  });

  it("handles the daylight-saving start (4 Oct 2026 is a 23-hour Sydney day)", async () => {
    expect(await createdAtFor("from=2026-10-04&to=2026-10-04")).toEqual({
      gte: new Date("2026-10-03T14:00:00.000Z"),
      lt: new Date("2026-10-04T13:00:00.000Z"),
    });
  });

  it("handles the daylight-saving end (5 Apr 2026 is a 25-hour Sydney day)", () => {
    expect(sydneyCreatedAtFilter("2026-04-05", "2026-04-05")).toEqual({
      gte: new Date("2026-04-04T13:00:00.000Z"),
      lt: new Date("2026-04-05T14:00:00.000Z"),
    });
  });

  it("means the same days as a custom Quality hub period", () => {
    const period = resolveQualityPeriod({ from: "2026-10-01", to: "2026-10-31" });
    expect(sydneyCreatedAtFilter("2026-10-01", "2026-10-31")).toEqual({ gte: period.start, lt: period.end });
  });

  it("reads a full timestamp as its Sydney day and ignores unreadable values", async () => {
    expect(sydneyCreatedAtFilter(null, "2026-11-10T20:00:00Z")).toEqual({ lt: new Date("2026-11-11T13:00:00.000Z") });
    expect(sydneyCreatedAtFilter("2026-02-30", "nonsense")).toBeUndefined();
    expect(await createdAtFor("to=garbage")).toBeUndefined();
  });

  it("answers auth errors with 401/403 and hides internal failures", async () => {
    m.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await GET(new NextRequest("http://localhost/api/admin/qa/issues"))).status).toBe(403);
    m.count.mockRejectedValueOnce(new Error("connection to 10.0.0.5 refused"));
    const failed = await GET(new NextRequest("http://localhost/api/admin/qa/issues"));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to load QA issues." });
  });
});
