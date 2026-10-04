// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), users: vi.fn(), find: vi.fn(), upsert: vi.fn(), audit: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: m.users }, appSetting: { findUnique: m.find }, $transaction: m.tx } }));
import { GET, PATCH } from "@/app/api/admin/settings/invoice-cadence/route";
const request = (ids: string[]) => new Request("http://localhost/api/admin/settings/invoice-cadence", { method: "PATCH", body: JSON.stringify({ semimonthlyClientUserIds: ids }) }) as any;
beforeEach(() => {
  vi.resetAllMocks(); m.role.mockResolvedValue({ user: { id: "admin" } }); m.find.mockResolvedValue(null);
  m.users.mockResolvedValue([]); m.tx.mockImplementation(async fn => fn({ appSetting: { findUnique: m.find, upsert: m.upsert }, auditLog: { create: m.audit } }));
});
it("reads missing settings as disabled without writing", async () => {
  expect(await (await GET()).json()).toEqual({ clients: [], semimonthlyClientUserIds: [] });
  expect(m.tx).not.toHaveBeenCalled();
});
it("rejects unauthorized writes", async () => {
  m.role.mockRejectedValue(new Error("FORBIDDEN")); expect((await PATCH(request([]))).status).toBe(403); expect(m.tx).not.toHaveBeenCalled();
});
it("refuses two logins for one billing account", async () => {
  m.users.mockResolvedValue([{ id: "a", clientId: "client" }, { id: "b", clientId: "client" }]);
  expect((await PATCH(request(["a", "b"]))).status).toBe(400); expect(m.tx).not.toHaveBeenCalled();
});
it("refuses unlinked or unavailable client users", async () => {
  m.users.mockResolvedValue([{ id: "a", clientId: null }]); expect((await PATCH(request(["a"]))).status).toBe(400);
  m.users.mockResolvedValue([]); expect((await PATCH(request(["unknown"]))).status).toBe(400); expect(m.tx).not.toHaveBeenCalled();
});
it("persists explicit opt-in and audit together, without invoice/send calls", async () => {
  m.users.mockResolvedValue([{ id: "a", clientId: "client" }]); expect((await PATCH(request(["a"]))).status).toBe(200);
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "finance-cadence" }, update: { value: { semimonthlyClientUserIds: ["a"] } } }));
  expect(m.audit).toHaveBeenCalledOnce();
});
it.each([['UNAUTHORIZED',401],['FORBIDDEN',403],['database unavailable',400]])('reports GET failure %s', async (message,status) => { m.role.mockRejectedValue(new Error(String(message))); expect((await GET()).status).toBe(status); });
it('handles non-Error failures without leaking details', async () => { m.role.mockRejectedValue(null); expect(await (await PATCH(request([]))).json()).toEqual({error:'Unable to save cadence.'}); });
it('reads malformed stored settings safely', async () => { m.find.mockResolvedValue({value:{semimonthlyClientUserIds:42}}); expect((await (await GET()).json()).semimonthlyClientUserIds).toEqual([]); });
it('audits replacement and deduplicates identical selected logins', async () => { m.find.mockResolvedValue({value:{semimonthlyClientUserIds:['old']}}); m.users.mockResolvedValue([{id:'a',clientId:'client'}]); expect((await PATCH(request(['a','a']))).status).toBe(200); expect(m.audit.mock.calls[0][0].data.before).toEqual({semimonthlyClientUserIds:['old']}); expect(m.upsert.mock.calls[0][0].update.value.semimonthlyClientUserIds).toEqual(['a']); });
