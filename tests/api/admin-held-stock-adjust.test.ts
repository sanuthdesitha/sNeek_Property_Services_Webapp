// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), adjust: vi.fn(), list: vi.fn(), groups: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/inventory/held-stock", () => ({ createHeldStock: vi.fn(), listHeldStock: m.list, getOnHandByHolder: m.groups }));
vi.mock("@/lib/inventory/self-held-stock", async original => ({ ...await original<any>(), adjustAdminHeldStock: m.adjust }));
vi.mock("@/lib/db", () => ({ db: {} }));
import { GET, PATCH } from "@/app/api/admin/inventory/held-stock/route";
import { adjustOwnHeldStockSchema, HeldStockEntryError } from "@/lib/inventory/self-held-stock";
const body = { requestId: "138293ca-452d-4de7-b9cb-54b6c54a6c99", heldStockId: "held", expectedUpdatedAt: "2026-09-22T01:00:00.000Z", quantity: 0, reason: "Stock count corrected" };
const req = (data: unknown = body) => new Request("http://local", { method: "PATCH", body: JSON.stringify(data) });
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin" } }); m.list.mockResolvedValue([]); m.groups.mockResolvedValue([]); m.adjust.mockImplementation(async (_actor, data) => { adjustOwnHeldStockSchema.parse(data); return { id: "held", duplicated: false }; }); });
it("authorizes office roles and attributes correction to session actor", async () => { const response = await PATCH(req()); expect(response.status).toBe(200); expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]); expect(m.adjust).toHaveBeenCalledWith("admin", body); expect(response.headers.get("cache-control")).toBe("private, no-store"); });
it.each(["FULL", "READ_ONLY"])("rejects %s impersonation", async mode => { m.auth.mockResolvedValue({ user: { id: "target" }, impersonation: { mode, actorId: "admin" } }); expect((await PATCH(req())).status).toBe(403); expect(m.adjust).not.toHaveBeenCalled(); });
it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]] as const)("denies %s before mutation", async (error, code) => { m.auth.mockRejectedValue(new Error(error)); expect((await PATCH(req())).status).toBe(code); expect(m.adjust).not.toHaveBeenCalled(); });
it("rejects caller ownership and malformed quantities", async () => { expect((await PATCH(req({ ...body, holderUserId: "other" }))).status).toBe(400); expect((await PATCH(req({ ...body, quantity: -1 }))).status).toBe(400); });
it("returns stale conflict without exposing internal errors", async () => { m.adjust.mockRejectedValue(new HeldStockEntryError(409, "Refresh current stock.")); const response = await PATCH(req()); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "Refresh current stock." }); m.adjust.mockRejectedValue(new Error("secret-db")); expect(await (await PATCH(req())).text()).not.toContain("secret-db"); });
it("retains zero-held entries for later correction", async () => { expect((await GET()).status).toBe(200); expect(m.list).toHaveBeenCalledWith({ includeEmpty: true }); expect(m.groups).toHaveBeenCalledWith({ includeEmpty: true }); });
