// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), property: vi.fn(), deliver: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { property: { findFirst: m.property } } }));
vi.mock("@/lib/inventory/held-stock", () => ({ deliverHeldStock: m.deliver }));
vi.mock("@/lib/inventory/held-stock-delivery-notification", () => ({ notifyHeldStockDelivery: m.notify }));
import { POST } from "@/app/api/cleaner/inventory/held-stock/[id]/deliver/route";
const request = () => POST(new NextRequest("http://local", { method: "POST", body: JSON.stringify({ propertyId: "property", quantity: 2 }) }), { params: { id: "held" } });
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "cleaner", role: "CLEANER" } }); m.property.mockResolvedValue({ id: "property" }); m.deliver.mockResolvedValue({ id: "delivery" }); });
it("requires an active assigned destination and binds holding ownership to session", async () => {
  expect((await request()).status).toBe(200);
  expect(m.property).toHaveBeenCalledWith({ where: { id: "property", isActive: true, jobs: { some: { assignments: { some: { userId: "cleaner", removedAt: null } } } } }, select: { id: true } });
  expect(m.deliver).toHaveBeenCalledWith(expect.objectContaining({ requireHolderUserId: "cleaner", deliveredById: "cleaner", heldStockId: "held" }));
});
it("rejects an inaccessible property before stock or email changes", async () => { m.property.mockResolvedValue(null); expect((await request()).status).toBe(403); expect(m.deliver).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled(); });
it("blocks read-only impersonation before checking stock", async () => { m.auth.mockResolvedValue({ user: { id: "cleaner", role: "CLEANER" }, impersonation: { mode: "READ_ONLY" } }); expect((await request()).status).toBe(403); expect(m.property).not.toHaveBeenCalled(); });
it("allows office roles active destinations without forging another holder", async () => { m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); expect((await request()).status).toBe(200); expect(m.property).toHaveBeenCalledWith({ where: { id: "property", isActive: true }, select: { id: true } }); expect(m.deliver).toHaveBeenCalledWith(expect.objectContaining({ requireHolderUserId: "admin" })); });
