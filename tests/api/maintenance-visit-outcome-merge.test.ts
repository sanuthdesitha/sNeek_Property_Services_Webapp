// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The visit route after the 2026-11-13 outcome merge: the five current values
 * store as sent; an earlier value from a screen that has not reloaded is
 * mapped and its original kept; unknown text is refused before any write.
 */
const m = vi.hoisted(() => ({
  auth: vi.fn(), assigned: vi.fn(), worker: vi.fn(), state: vi.fn(), sync: vi.fn(),
  detail: vi.fn(), admins: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/maintenance/workers", () => ({
  userIsAssignedWorker: m.assigned, getWorkerForUser: m.worker, setMaintenanceVisitState: m.state,
}));
vi.mock("@/lib/cases/damage-maintenance-sync", () => ({ syncCaseFromMaintenance: m.sync }));
vi.mock("@/lib/db", () => ({
  db: { propertyMaintenanceItem: { findUnique: m.detail }, user: { findMany: m.admins }, notification: { createMany: m.notify } },
}));
import { POST } from "@/app/api/maintenance/[id]/visit/route";

const complete = (outcome: string) =>
  POST(
    new NextRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ event: "COMPLETE", outcome, finishPhotoKeys: ["p.jpg"] }),
    }),
    { params: { id: "item" } }
  );

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: "worker-user", role: "MAINTENANCE" } });
  m.assigned.mockResolvedValue(true);
  m.worker.mockResolvedValue({ id: "worker" });
  m.state.mockResolvedValue({ id: "item", status: "RESOLVED" });
  m.detail.mockResolvedValue({ title: "Repair", contactPersonUserId: null, property: { name: "Home" }, assignedWorker: { name: "Worker" } });
  m.admins.mockResolvedValue([{ id: "office" }]);
});

describe("POST /api/maintenance/[id]/visit outcomes", () => {
  it("stores a current outcome as sent, with no original", async () => {
    expect((await complete("REPLACED_OR_REPAIRED")).status).toBe(200);
    expect(m.state).toHaveBeenCalledWith(expect.objectContaining({ outcome: "REPLACED_OR_REPAIRED", originalOutcome: null }));
  });

  it.each([
    ["FIXED", "REPLACED_OR_REPAIRED"],
    ["REPLACED", "REPLACED_OR_REPAIRED"],
    ["OTHER", "NEEDS_FOLLOWUP"],
  ])("maps an earlier %s to %s and keeps the original", async (sent, stored) => {
    expect((await complete(sent)).status).toBe(200);
    expect(m.state).toHaveBeenCalledWith(expect.objectContaining({ outcome: stored, originalOutcome: sent }));
  });

  it("refuses unknown text before any write", async () => {
    const res = await complete("SORTED");
    expect(res.status).toBe(400);
    expect(m.state).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
});
