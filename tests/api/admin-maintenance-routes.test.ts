// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  list: vi.fn(),
  findAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  assign: vi.fn(),
  notice: vi.fn(),
  status: vi.fn(),
  settings: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/maintenance/admin-list", async (original) => ({ ...(await original<typeof import("@/lib/maintenance/admin-list")>()), listAdminMaintenance: m.list }));
vi.mock("@/lib/db", () => ({ db: { maintenanceItemAssignment: { findUnique: m.findAssignment, update: m.updateAssignment } } }));
vi.mock("@/lib/maintenance/workers", () => ({ assignMaintenanceItem: m.assign }));
vi.mock("@/lib/maintenance/assign-notice", () => ({ recordWorkerAssignedNotice: m.notice }));
vi.mock("@/lib/maintenance/service", () => ({ updateMaintenanceStatus: m.status }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));

import { GET as listGET } from "@/app/api/admin/maintenance/route";
import { PATCH as assignmentPATCH } from "@/app/api/admin/maintenance/assignments/[id]/route";
import { POST as bulkPOST } from "@/app/api/maintenance/bulk/route";

const ADMIN = { user: { id: "admin", role: "ADMIN" } };
const OPS = { user: { id: "ops", role: "OPS_MANAGER" } };

function listReq(query: string) {
  const url = new URL(`http://localhost/api/admin/maintenance?${query}`);
  return Object.assign(new Request(url), { nextUrl: url }) as never;
}
const patch = (body: unknown) => assignmentPATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) }) as never, { params: { id: "as1" } });
const bulk = (body: unknown) => bulkPOST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  vi.resetAllMocks();
  m.list.mockResolvedValue({ rows: [], total: 0 });
  m.settings.mockResolvedValue({ timezone: "Australia/Sydney", companyName: "sNeek" });
  m.findAssignment.mockResolvedValue({
    id: "as1", userId: "u1", removedAt: null, payType: "FIXED", payAmount: 180, payHours: null, payPayer: "COMPANY",
    payChangeAmount: 220, payChangeStatus: "PENDING", user: { id: "u1", name: "Dan", email: null }, item: { id: "i1", title: "Dishwasher", property: { name: "Bondi" } },
  });
});

describe("GET /api/admin/maintenance", () => {
  it("is for the office: a refused role reads nothing", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await listGET(listReq(""))).status).toBe(403);
    m.role.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await listGET(listReq(""))).status).toBe(401);
    expect(m.list).not.toHaveBeenCalled();
  });

  it("asks the live guard for ADMIN and OPS_MANAGER and passes parsed filters and paging", async () => {
    m.role.mockResolvedValue(OPS);
    const response = await listGET(listReq("assigned=none&price=PENDING&sort=visit&dir=asc&page=2"));
    expect(response.status).toBe(200);
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.list.mock.calls[0][0]).toMatchObject({ filters: { assigned: "none", price: "PENDING" }, query: { sort: "visit", dir: "asc", page: 2 }, timeZone: "Australia/Sydney" });
  });

  it("refuses an unknown sort or filter with 400 instead of showing an unasked-for list", async () => {
    m.role.mockResolvedValue(ADMIN);
    expect((await listGET(listReq("sort=secret"))).status).toBe(400);
    expect((await listGET(listReq("price=PAID"))).status).toBe(400);
    expect(m.list).not.toHaveBeenCalled();
  });
});

describe("worker price requests (owner default: only ADMIN approves)", () => {
  it("refuses an operations manager's approval before touching the assignment", async () => {
    m.role.mockResolvedValue(OPS);
    const response = await patch({ action: "APPROVE_PAY_CHANGE" });
    expect(response.status).toBe(403);
    expect(m.findAssignment).not.toHaveBeenCalled();
    expect(m.updateAssignment).not.toHaveBeenCalled();
  });

  it("lets an administrator approve, replacing the agreed figure", async () => {
    m.role.mockResolvedValue(ADMIN);
    const response = await patch({ action: "APPROVE_PAY_CHANGE" });
    expect(response.status).toBe(200);
    expect(m.updateAssignment).toHaveBeenCalledWith({ where: { id: "as1" }, data: { payChangeStatus: "APPROVED", payAmount: 220 } });
  });

  it("still lets an operations manager decline the request", async () => {
    m.role.mockResolvedValue(OPS);
    const response = await patch({ action: "REJECT_PAY_CHANGE" });
    expect(response.status).toBe(200);
    expect(m.updateAssignment).toHaveBeenCalledWith({ where: { id: "as1" }, data: { payChangeStatus: "REJECTED" } });
  });
});

describe("POST /api/maintenance/bulk", () => {
  it("answers status changes per item with the earlier status, for Undo", async () => {
    m.role.mockResolvedValue(ADMIN);
    m.status.mockResolvedValue({ updated: 2, results: [{ id: "a", outcome: "done", fromStatus: "OPEN" }, { id: "b", outcome: "unchanged", fromStatus: "IN_PROGRESS" }] });
    const response = await bulk({ ids: ["a", "b"], status: "IN_PROGRESS" });
    expect(await response.json()).toMatchObject({ results: [{ id: "a", outcome: "done", fromStatus: "OPEN" }, { id: "b", outcome: "unchanged" }] });
  });

  it("assigns one visit worker per item, keeps the visit fields, reports a refused item and notices only new assignments", async () => {
    m.role.mockResolvedValue(OPS);
    m.assign.mockImplementation(async ({ itemId }: { itemId: string }) => {
      if (itemId === "gone") throw new Error("Maintenance item not found.");
      return { id: itemId, unchanged: itemId === "same" };
    });
    m.notice.mockResolvedValue(true);
    const response = await bulk({ ids: ["a", "same", "gone"], assign: { workerId: "w1" } });
    const body = await response.json();
    expect(body.results).toEqual([
      { id: "a", outcome: "done" },
      { id: "same", outcome: "unchanged" },
      { id: "gone", outcome: "refused", reason: "Maintenance item not found." },
    ]);
    expect(m.assign).toHaveBeenCalledWith({ itemId: "a", workerId: "w1", assignedByUserId: "ops" });
    expect(m.notice).toHaveBeenCalledTimes(1);
  });

  it("is refused whole for a role without access", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await bulk({ ids: ["a"], assign: { workerId: "w1" } })).status).toBe(403);
    expect(m.assign).not.toHaveBeenCalled();
  });
});
