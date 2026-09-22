// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), record: vi.fn(), adjust: vi.fn(), items: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/inventory/held-stock", () => ({ listHeldStock: m.list }));
vi.mock("@/lib/inventory/self-held-stock", async original => ({ ...await original<any>(), recordOwnHeldStock: m.record, adjustOwnHeldStock: m.adjust }));
vi.mock("@/lib/db", () => ({ db: { inventoryItem: { findMany: m.items } } }));
import { HeldStockEntryError, adjustOwnHeldStockSchema } from "@/lib/inventory/self-held-stock";
import { GET, POST, PATCH } from "@/app/api/cleaner/inventory/held-stock/route";
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "cleaner-a" } }); m.list.mockResolvedValue([]); m.items.mockResolvedValue([]); m.record.mockResolvedValue({ id: "held", duplicated: false }); m.adjust.mockImplementation(async (_owner, body) => { adjustOwnHeldStockSchema.parse(body); return { id: "held", duplicated: false }; }); });
it("reads only current actor stock and active minimal catalogue", async () => { const response = await GET(); expect(response.status).toBe(200); expect(m.list).toHaveBeenCalledWith({ holderUserId: "cleaner-a", includeEmpty: true }); expect(m.items).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true }, select: { id: true, name: true, unit: true } })); expect(response.headers.get("cache-control")).toBe("private, no-store"); });
it("sets ownership from the session, never request JSON", async () => { const body = { itemId: "soap", quantity: 2 }; await POST(new Request("http://local", { method: "POST", body: JSON.stringify(body) })); expect(m.record).toHaveBeenCalledWith("cleaner-a", body, "cleaner-a"); });
it("blocks read-only impersonation writes", async () => { m.auth.mockResolvedValue({ user: { id: "cleaner-a" }, impersonation: { mode: "READ_ONLY", actorId: "admin" } }); expect((await POST(new Request("http://local", { method: "POST", body: "{}" }))).status).toBe(403); expect(m.record).not.toHaveBeenCalled(); });
it("retains full impersonation attribution", async () => { m.auth.mockResolvedValue({ user: { id: "cleaner-a" }, impersonation: { mode: "FULL", actorId: "admin" } }); await POST(new Request("http://local", { method: "POST", body: "{}" })); expect(m.record).toHaveBeenCalledWith("cleaner-a", {}, "admin"); });
it.each(["UNAUTHORIZED", "FORBIDDEN"])("rejects %s before reads or writes", async error => { m.auth.mockRejectedValue(new Error(error)); expect((await GET()).status).toBe(error === "UNAUTHORIZED" ? 401 : 403); expect((await POST(new Request("http://local", { method: "POST", body: "{}" }))).status).toBe(error === "UNAUTHORIZED" ? 401 : 403); expect(m.list).not.toHaveBeenCalled(); expect(m.record).not.toHaveBeenCalled(); });
const adjustment = { requestId: "138293ca-452d-4de7-b9cb-54b6c54a6c99", heldStockId: "held", expectedUpdatedAt: "2026-09-22T01:00:00.000Z", quantity: 0, reason: "Used while cleaning" };
const patchRequest = (body: unknown = adjustment) => new Request("http://local", { method: "PATCH", body: JSON.stringify(body) });
it("PATCH passes authenticated ownership and returns a private adjustment receipt", async () => {
  const response = await PATCH(patchRequest()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, id: "held", duplicated: false });
  expect(m.adjust).toHaveBeenCalledWith("cleaner-a", adjustment, "cleaner-a"); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("PATCH blocks read-only impersonation before adjustment", async () => {
  m.auth.mockResolvedValue({ user: { id: "cleaner-a" }, impersonation: { mode: "READ_ONLY", actorId: "admin" } });
  expect((await PATCH(patchRequest())).status).toBe(403); expect(m.adjust).not.toHaveBeenCalled();
});
it("PATCH binds full impersonation to target ownership and real audit actor", async () => {
  m.auth.mockResolvedValue({ user: { id: "cleaner-a" }, impersonation: { mode: "FULL", actorId: "admin" } });
  expect((await PATCH(patchRequest())).status).toBe(200); expect(m.adjust).toHaveBeenCalledWith("cleaner-a", adjustment, "admin");
});
it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]] as const)("PATCH rejects %s before adjustment", async (message, status) => {
  m.auth.mockRejectedValue(new Error(message)); expect((await PATCH(patchRequest())).status).toBe(status); expect(m.adjust).not.toHaveBeenCalled();
});
it("PATCH returns the actionable stale-version conflict", async () => {
  m.adjust.mockRejectedValue(new HeldStockEntryError(409, "This holding changed. Refresh stock.")); const response = await PATCH(patchRequest());
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "This holding changed. Refresh stock." }); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each([null, {}, { ...adjustment, quantity: -1 }, { ...adjustment, holderUserId: "another-cleaner" }])("PATCH rejects malformed or caller-owned adjustment %#", async body => {
  const response = await PATCH(patchRequest(body)); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Invalid stock entry." });
});
it("PATCH invalid JSON produces the same sanitized400", async () => {
  const response = await PATCH(new Request("http://local", { method: "PATCH", body: "invalid-json" })); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Invalid stock entry." });
});
