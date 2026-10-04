// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), assigned: vi.fn(), worker: vi.fn(), state: vi.fn(), sync: vi.fn(), detail: vi.fn(), admins: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/maintenance/workers", () => ({ userIsAssignedWorker: m.assigned, getWorkerForUser: m.worker, setMaintenanceVisitState: m.state }));
vi.mock("@/lib/cases/damage-maintenance-sync", () => ({ syncCaseFromMaintenance: m.sync }));
vi.mock("@/lib/db", () => ({ db: { propertyMaintenanceItem: { findUnique: m.detail }, user: { findMany: m.admins }, notification: { createMany: m.notify } } }));
import { POST } from "@/app/api/maintenance/[id]/visit/route";
const run = (event: string) => POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ event }) }), { params: { id: "item" } });
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "worker-user", role: "MAINTENANCE" } }); m.assigned.mockResolvedValue(true); m.worker.mockResolvedValue({ id: "worker" }); m.state.mockResolvedValue({ id: "item", status: "IN_PROGRESS" }); m.detail.mockResolvedValue({ title: "Repair", contactPersonUserId: "office", property: { name: "Home" }, assignedWorker: { name: "Worker" } }); m.admins.mockResolvedValue([{ id: "office" }]); });
it("unassigned worker cannot change state, sync cases or notify", async () => {
 m.assigned.mockResolvedValue(false);
 expect((await run("START")).status).toBe(403);
 expect(m.state).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
it.each(["COMPLETE", "START", "CLOCK_IN", "EN_ROUTE"])("syncs returned maintenance status after %s and sends one categorized recipient notice", async event => {
 expect((await run(event)).status).toBe(200);
 expect(m.state).toHaveBeenCalledWith(expect.objectContaining({ itemId: "item", workerId: "worker", userId: "worker-user", event }));
 expect(m.sync).toHaveBeenCalledWith({ itemId: "item", status: "IN_PROGRESS" });
 expect(m.state.mock.invocationCallOrder[0]).toBeLessThan(m.sync.mock.invocationCallOrder[0]);
 expect(m.notify.mock.calls[0][0].data).toEqual([expect.objectContaining({ userId: "office", externalId: expect.stringContaining("cases"), channel: "PUSH" })]);
});
it.each(["ARRIVED", "CLOCK_OUT"])("does not resync case for %s", async event => {
 expect((await run(event)).status).toBe(200); expect(m.sync).not.toHaveBeenCalled();
});
it("state write failure stops case synchronization and notification", async () => {
 m.state.mockRejectedValue(new Error("invalid transition"));
 expect((await run("START")).status).toBe(400); expect(m.sync).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
it("notification failure does not turn a completed state/sync into a retry response", async () => {
 m.notify.mockRejectedValue(new Error("notification unavailable"));
 expect((await run("START")).status).toBe(200); expect(m.sync).toHaveBeenCalledOnce();
});
