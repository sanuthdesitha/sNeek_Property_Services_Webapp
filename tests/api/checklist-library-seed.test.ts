// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), seed: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/checklists/library", () => ({ seedChecklistLibraryFromCatalog: m.seed }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: m.audit } } }));
import { POST } from "@/app/api/admin/checklist-library/seed/route";
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin" } }); m.seed.mockResolvedValue({ modules: 3, items: 12, skipped: false }); });
it("explicit administrator action seeds and records its result", async () => {
 const response = await POST(); expect(response.status).toBe(200); const result = await response.json();
 expect(m.auth).toHaveBeenCalledWith(["ADMIN"]); expect(m.seed).toHaveBeenCalledOnce();
 expect(m.audit).toHaveBeenCalledWith({ data: { userId: "admin", action: "CHECKLIST_LIBRARY_SEED", entity: "ChecklistModule", entityId: "standard-library", after: result } });
});
it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("does not seed on %s", async (message, status) => {
 m.auth.mockRejectedValue(new Error(String(message))); expect((await POST()).status).toBe(status); expect(m.seed).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
it("returns seed failure without reporting a successful audit", async () => {
 m.seed.mockRejectedValue(new Error("Seed failed")); const response = await POST(); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Seed failed" }); expect(m.audit).not.toHaveBeenCalled();
});
