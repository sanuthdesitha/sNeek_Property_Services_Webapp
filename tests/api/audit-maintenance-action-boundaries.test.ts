// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), item: vi.fn(), access: vi.fn(), quote: vi.fn(), decision: vi.fn(), assign: vi.fn(), route: vi.fn(), attach: vi.fn(), status: vi.fn(), edit: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.auth }));
vi.mock("@/lib/maintenance/service", () => ({ getMaintenanceItem: m.item, updateMaintenanceItem: m.edit, updateMaintenanceStatus: m.status, setMaintenanceQuote: m.quote, decideMaintenanceCost: m.decision }));
vi.mock("@/lib/maintenance/access", () => ({ resolvePropertyAccess: m.access, resolvePhotoUrls: async () => [] }));
vi.mock("@/lib/maintenance/workers", () => ({ userIsAssignedWorker: vi.fn(), assignMaintenanceItem: m.assign, routeMaintenanceToAdmin: m.route, attachMaintenanceItemToJob: m.attach }));
vi.mock("@/lib/db", () => ({ db: { propertyMaintenanceItem: { update: m.update } } }));
vi.mock("@/lib/security/encryption", () => ({ decryptSecret: vi.fn() }));
import { PATCH } from "@/app/api/maintenance/[id]/route";
const run = (body: unknown) => PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "item" } });
const mutations = () => [m.quote, m.decision, m.assign, m.route, m.attach, m.status, m.edit, m.update];
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "actor", role: "ADMIN" } }); m.item.mockResolvedValue({ id: "item", propertyId: "property", jobId: null, clientVisible: true, photoKeys: [] }); m.access.mockResolvedValue({ allowed: true, clientVisibleOnly: false }); });
it("owning client cannot combine an allowed cost decision with forbidden job attachment", async () => {
 m.auth.mockResolvedValue({ user: { id: "client", role: "CLIENT" } });
 expect((await run({ costDecision: "APPROVED", attachJobId: "job" })).status).toBe(403);
 mutations().forEach(fn => expect(fn).not.toHaveBeenCalled());
});
it.each([
 { quotedCost: 20, costDecision: "APPROVED" },
 { assignWorkerId: "worker", attachJobId: "job" },
 { title: "Fix", assignmentInstructions: [] },
 { status: "OPEN", quotedCost: 20 },
])("rejects multiple action groups before any partial write: %j", async body => {
 const response = await run(body);
 expect(response.status).toBe(400); expect((await response.json()).error).toBe("Save one maintenance action at a time.");
 mutations().forEach(fn => expect(fn).not.toHaveBeenCalled());
});
it("admin single attachment delegates exact object and actor", async () => {
 expect((await run({ attachJobId: "job" })).status).toBe(200);
 expect(m.attach).toHaveBeenCalledWith({ itemId: "item", jobId: "job", actorUserId: "actor" });
 expect(m.quote).not.toHaveBeenCalled(); expect(m.edit).not.toHaveBeenCalled();
});
it("single quote write failure does not proceed to later writes or claim success", async () => {
 m.quote.mockRejectedValue(new Error("quote failed"));
 expect((await run({ quotedCost: 20 })).status).toBe(400);
 expect(m.item).toHaveBeenCalledOnce(); expect(m.attach).not.toHaveBeenCalled();
});
it("denied property scope prevents action planning and writes", async () => {
 m.access.mockResolvedValue({ allowed: false });
 expect((await run({ attachJobId: "job" })).status).toBe(403);
 mutations().forEach(fn => expect(fn).not.toHaveBeenCalled());
});
