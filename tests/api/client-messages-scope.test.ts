// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/client/messages/route";
const mocks = vi.hoisted(() => ({ portal: vi.fn(), jobs: vi.fn(), messages: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: mocks.portal, auditClientPortalAction: vi.fn(), propertyScopeWhere: (p: any) => ({ clientId: p.clientId, ...(p.propertyIds ? { id: { in: p.propertyIds } } : {}) }) }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: mocks.jobs }, clientMessage: { findMany: mocks.messages, updateMany: mocks.read } } }));
vi.mock("@/lib/notifications/admin-alerts", () => ({ notifyAdminsByEmail: vi.fn(), notifyAdminsByPush: vi.fn() }));
const rows = [
  { id: "global", clientId: "client", jobId: null, isFromAdmin: true, isRead: false },
  { id: "allowed", clientId: "client", jobId: "job", isFromAdmin: true, isRead: false },
  { id: "mine", clientId: "client", jobId: "job", isFromAdmin: false, isRead: false },
  { id: "read", clientId: "client", jobId: "job", isFromAdmin: true, isRead: true },
  { id: "hidden", clientId: "client", jobId: "other", isFromAdmin: true, isRead: false },
  { id: "foreign", clientId: "other", jobId: null, isFromAdmin: true, isRead: false },
];
const request = (query = "") => GET(new NextRequest(`http://localhost/api/client/messages${query}`));
beforeEach(() => {
  vi.resetAllMocks(); mocks.portal.mockResolvedValue({ clientId: "client", actor: "VA", propertyIds: ["allowed"] });
  mocks.jobs.mockResolvedValue([{ id: "job", jobNumber: "J001", property: { name: "Allowed property" } }]);
  mocks.messages.mockImplementation(async ({ where, take }) => rows.filter((row) => row.clientId === where.clientId && (where.jobId ? row.jobId === where.jobId : row.jobId === null || where.OR[1].jobId.in.includes(row.jobId))).slice(0, take));
  mocks.read.mockResolvedValue({ count: 2 });
});
describe("client message read scope", () => {
  it("filters inaccessible threads and only acknowledges returned unread admin rows", async () => {
    const response = await request(); const body = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.portal).toHaveBeenCalledWith({ permission: "messages" });
    expect(mocks.jobs.mock.calls[0][0].where).toEqual({ property: { clientId: "client", id: { in: ["allowed"] } } });
    expect(body.map((row: any) => row.id)).toEqual(["global", "allowed", "mine", "read"]); expect(body[0].job).toBeNull(); expect(body[1].job).toEqual({ id: "job", jobNumber: "J001", propertyName: "Allowed property" });
    expect(mocks.read).toHaveBeenCalledWith({ where: { clientId: "client", id: { in: ["global", "allowed"] }, isFromAdmin: true, isRead: false }, data: { isRead: true } });
  });
  it("validates explicit job within actor property scope before reading", async () => {
    const body = await (await request("?jobId=%20job%20")).json(); expect(body).toHaveLength(3); expect(mocks.jobs.mock.calls[0][0].where).toEqual({ id: "job", property: { clientId: "client", id: { in: ["allowed"] } } }); expect(mocks.read.mock.calls[0][0].where.id.in).toEqual(["allowed"]);
  });
  it("rejects inaccessible or missing explicit jobs without read acknowledgement", async () => {
    mocks.jobs.mockResolvedValue([]); const response = await request("?jobId=hidden"); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "Job not found." }); expect(mocks.messages).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("empty property scope still permits existing global conversation only", async () => {
    mocks.portal.mockResolvedValue({ clientId: "client", actor: "VA", propertyIds: [] }); mocks.jobs.mockResolvedValue([]); const body = await (await request()).json(); expect(body.map((r: any) => r.id)).toEqual(["global"]); expect(mocks.jobs.mock.calls[0][0].where.property.id.in).toEqual([]); expect(mocks.read.mock.calls[0][0].where.id.in).toEqual(["global"]);
  });
  it.each(["CLIENT", "VA"])("unrestricted %s still uses client ownership", async (actor) => {
    mocks.portal.mockResolvedValue({ clientId: "client", actor, propertyIds: null }); await request(); expect(mocks.jobs.mock.calls[0][0].where).toEqual({ property: { clientId: "client" } });
  });
  it("never marks unseen rows beyond page cap", async () => {
    mocks.messages.mockResolvedValue(Array.from({ length: 500 }, (_, index) => ({ ...rows[0], id: `loaded-${index}` })));
    await request(); expect(mocks.messages.mock.calls[0][0].take).toBe(500); expect(mocks.read.mock.calls[0][0].where.id.in).toHaveLength(500); expect(mocks.read.mock.calls[0][0].where.id.in).not.toContain("unseen");
  });
  it("does not write for empty or already-read results", async () => { mocks.messages.mockResolvedValue([rows[2], rows[3]]); await request(); expect(mocks.read).not.toHaveBeenCalled(); mocks.messages.mockResolvedValue([]); expect(await (await request()).json()).toEqual([]); });
  it.each(["UNAUTHORIZED", "FORBIDDEN"])("denies %s before queries", async (error) => { mocks.portal.mockRejectedValue(new Error(error)); expect((await request()).status).toBe(error === "UNAUTHORIZED" ? 401 : 403); expect(mocks.jobs).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); });
  it("does not acknowledge when message load fails and masks storage errors", async () => { mocks.messages.mockRejectedValue(new Error("private storage data")); const response = await request(); expect(response.ok).toBe(false); expect(await response.json()).toEqual({ error: "Could not load messages." }); expect(mocks.read).not.toHaveBeenCalled(); });
});
