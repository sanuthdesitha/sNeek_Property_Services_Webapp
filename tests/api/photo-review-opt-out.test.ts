// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), rows: new Map<string, unknown>(), audit: vi.fn(), properties: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => {
  const appSetting = {
    findUnique: async ({ where }: { where: { key: string } }) => (m.rows.has(where.key) ? { value: m.rows.get(where.key) } : null),
    upsert: async ({ where, update }: { where: { key: string }; update: { value: unknown } }) => { m.rows.set(where.key, update.value); },
  };
  const property = { findMany: m.properties };
  const tx = { $executeRaw: vi.fn(), appSetting, property, auditLog: { create: m.audit } };
  return { db: { appSetting, property, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } };
});
import { GET, PUT } from "@/app/api/admin/ai/photo-review-opt-out/route";
import { isPropertyOptedOut } from "@/lib/ai/photo-review-opt-out";

const put = (body: unknown) => new Request("http://local", { method: "PUT", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); m.rows.clear();
  m.role.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.properties.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) => (where.id?.in ?? ["p1", "p2"]).filter((id) => ["p1", "p2"].includes(id)).map((id) => ({ id, name: id, suburb: "" })));
});

it("saves with a revision guard and an audit entry, and the queue then sees the property as opted out", async () => {
  const response = await PUT(put({ expectedRevision: 0, propertyIds: ["p2", "p1", "p1"] }));
  expect(response.status).toBe(200);
  expect(await isPropertyOptedOut("p1")).toBe(true);
  expect(await isPropertyOptedOut("p3")).toBe(false);
  expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "AI_PHOTO_REVIEW_OPT_OUT_UPDATED", after: { propertyIds: ["p1", "p2"] } }) });
  const stale = await PUT(put({ expectedRevision: 0, propertyIds: [] }));
  expect(stale.status).toBe(409);
  expect((await stale.json()).current).toEqual({ revision: 1, propertyIds: ["p1", "p2"] });
});

it("refuses unknown properties, impersonation and non-administrators; office managers can read", async () => {
  expect((await PUT(put({ expectedRevision: 0, propertyIds: ["ghost"] }))).status).toBe(400);
  m.role.mockResolvedValueOnce({ user: { id: "admin-1" }, impersonation: { actorId: "admin-1", mode: "FULL" } });
  expect((await PUT(put({ expectedRevision: 0, propertyIds: [] }))).status).toBe(403);
  m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await PUT(put({ expectedRevision: 0, propertyIds: [] }))).status).toBe(403);
  m.role.mockResolvedValueOnce({ user: { id: "ops", role: "OPS_MANAGER" } });
  expect((await GET()).status).toBe(200);
  expect(m.audit).not.toHaveBeenCalled();
});

it("treats an unreadable saved list as opted out for every property", async () => {
  m.rows.set("ai_photo_review_opt_out_v1", { nonsense: true });
  expect(await isPropertyOptedOut("p1")).toBe(true);
});
