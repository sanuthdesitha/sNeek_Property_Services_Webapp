// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  listCases: vi.fn(),
  assignees: vi.fn(),
  migrate: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { issueTicket: { findMany: m.findMany, count: m.count, groupBy: m.groupBy } } }));
vi.mock("@/lib/cases/service", () => ({
  listCases: m.listCases,
  listCaseAssignees: m.assignees,
  createCase: vi.fn(),
  ensureLegacyDisputesMigrated: m.migrate,
}));
vi.mock("@/lib/cases/notifications", () => ({ notifyCaseCreated: vi.fn() }));

import { GET } from "@/app/api/admin/cases/route";

const pageRow = {
  id: "c1", title: "Scratched bench top", status: "WAITING_CLIENT", severity: "HIGH", caseType: "DAMAGE", source: null,
  slaBreachAt: null, createdAt: new Date("2026-11-09T00:00:00Z"), updatedAt: new Date("2026-11-10T00:00:00Z"),
  clientVisible: true, clientCanReply: true, jobId: "j1", reportId: null, clientId: "cl", propertyId: "p", metadata: { invoiceRef: "INV-0412" },
  job: { id: "j1", jobNumber: "J-1031", scheduledDate: new Date("2026-11-06T00:00:00Z"), property: null },
  client: { id: "cl", name: "Harbour View Stays" }, property: { id: "p", name: "Bondi Studio", suburb: null },
  assignedTo: { id: "me", name: "Me", email: "me@x", role: "ADMIN" },
  _count: { comments: 4, attachments: 2 },
  comments: [{ body: "Could you quote for a repair?", createdAt: new Date("2026-11-11T08:05:00Z"), author: { name: "Harbour", email: "h@x", role: "CLIENT" } }],
};

function get(query: string) {
  return GET(new Request(`http://localhost/api/admin/cases?${query}`) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "me", name: "Me", email: "me@x", role: "ADMIN" } });
  m.assignees.mockResolvedValue([]);
  m.count.mockResolvedValue(3);
  m.groupBy.mockResolvedValue([{ caseType: "DAMAGE", _count: { _all: 2 } }, { caseType: "weird", _count: { _all: 1 } }]);
  m.findMany.mockImplementation(async (args: { select?: Record<string, unknown>; include?: unknown }) => {
    if (args.select && "comments" in args.select) return [{ id: "c1", comments: [{ author: { role: "CLIENT" } }] }];
    if (args.select) return [{ id: "c1", status: "WAITING_CLIENT", severity: "HIGH", caseType: "DAMAGE", slaBreachAt: null, createdAt: new Date(), updatedAt: new Date() }];
    return [pageRow];
  });
});

describe("GET /api/admin/cases?shape=summary", () => {
  it("returns summaries only: counts and a last-message excerpt, no comment or attachment bodies", async () => {
    const response = await get("shape=summary&queue=needsReply");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.rows[0]).toMatchObject({
      id: "c1", commentCount: 4, attachmentCount: 2, clientReplied: true, invoiceRef: "INV-0412",
      lastMessage: { excerpt: "Could you quote for a repair?", fromClient: true },
    });
    expect(body.rows[0]).not.toHaveProperty("comments");
    expect(body.rows[0]).not.toHaveProperty("attachments");
    expect(body.counts.open).toBe(3);
    expect(body.typeCounts).toMatchObject({ DAMAGE: 2, OTHER: 1 });
    // The page read asks only for the latest public message, never every comment.
    const pageCall = m.findMany.mock.calls.find(([args]) => args.include);
    expect(pageCall?.[0].include.comments).toMatchObject({ where: { isInternal: false }, take: 1 });
    expect(pageCall?.[0].include).not.toHaveProperty("attachments");
  });

  it("honours ?jobId as a filter on every query", async () => {
    await get("shape=summary&queue=all&jobId=job_1");
    const keysCall = m.findMany.mock.calls.find(([args]) => args.select && !("comments" in args.select));
    expect(JSON.stringify(keysCall?.[0].where)).toContain('"jobId":"job_1"');
  });

  it.each([
    ["sort=title", "sort"],
    ["dir=sideways", "dir"],
    ["pageSize=1000", "pageSize"],
    ["queue=nonsense", "filter"],
    ["status=MAYBE", "filter"],
  ])("refuses %s with 400", async (query, field) => {
    const response = await get(`shape=summary&${query}`);
    expect(response.status).toBe(400);
    expect((await response.json()).field).toBe(field);
  });

  it("refuses non-office roles", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await get("shape=summary")).status).toBe(403);
  });

  it("keeps the old response shape for callers that do not ask for summaries", async () => {
    m.listCases.mockResolvedValue([{ id: "c1", comments: [{ id: "x" }], attachments: [] }]);
    const body = await (await get("status=OPEN")).json();
    expect(Object.keys(body).sort()).toEqual(["assignees", "items", "viewer"]);
    expect(body.items[0].comments).toHaveLength(1);
    expect(m.listCases).toHaveBeenCalledWith(expect.objectContaining({ status: "OPEN" }));
  });
});
