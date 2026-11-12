// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ session: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { job: { count: m.count } } }));
import { POST } from "@/app/api/admin/jobs/view-counts/route";
import { buildJobsWhere, readJobsFilterParams } from "@/lib/jobs/list-filters";
import { savedViewQuery } from "@/components/v2/admin/jobs/use-saved-view-counts";
import { DEFAULT_JOBS_COLUMNS } from "@/lib/jobs/workspace-state";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/jobs/view-counts", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "owner", role: Role.ADMIN } });
  m.count.mockImplementation(async ({ where }: { where: { OR?: unknown[] } }) => (where.OR ? 7 : 3));
});

const snapshot = {
  dateScope: "all", statusChip: "UNASSIGNED,OFFERED", sort: "soonest", search: "Bondi", view: "list", jobType: "all",
  clientId: "all", propertyId: "all", cleanerId: "all", dateFrom: "", dateTo: "", invoiced: "all", density: "default",
  columns: DEFAULT_JOBS_COLUMNS,
};

describe("saved view tab counts", () => {
  it("counts every saved view in one request with the list's own where-builder, search included", async () => {
    const query = savedViewQuery({ id: "11111111-1111-4111-8111-111111111111", name: "Bondi", snapshot });
    const response = await post({ views: [{ id: "v1", query }, { id: "v2", query: "paginated=1&status=COMPLETED" }] });
    expect(response.status).toBe(200);
    expect((await response.json()).counts).toEqual([{ id: "v1", count: 7, reason: null }, { id: "v2", count: 3, reason: null }]);
    expect(m.count).toHaveBeenCalledTimes(2);
    const params = new URLSearchParams(query);
    const expected = buildJobsWhere({ ...readJobsFilterParams(params), status: ["UNASSIGNED", "OFFERED"], role: Role.ADMIN, userId: "owner" });
    expect(m.count.mock.calls[0][0].where).toEqual(expected);
    expect(m.count.mock.calls[0][0].where.OR).toHaveLength(5);
  });

  it("gives a view whose stored filter no longer parses no number, with the reason (never 0)", async () => {
    const body = await (await post({ views: [{ id: "bad", query: "status=ARCHIVED" }] })).json();
    expect(body.counts).toEqual([{ id: "bad", count: null, reason: "Unknown job status: ARCHIVED." }]);
    expect(m.count).not.toHaveBeenCalled();
  });

  it("bounds the number of views and keeps the role guard", async () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ id: `v${index}`, query: "" }));
    expect((await post({ views: many })).status).toBe(400);
    m.session.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await post({ views: [] })).status).toBe(403);
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });
});
