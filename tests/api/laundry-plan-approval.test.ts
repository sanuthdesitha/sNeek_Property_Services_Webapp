// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/laundry/generate-week/route";
const m = vi.hoisted(() => ({ apply: vi.fn(), build: vi.fn(), notify: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { role: "ADMIN", id: "admin" } }) }));
vi.mock("@/lib/laundry/planner", () => ({ applyLaundryPlanDraft: m.apply, buildLaundryPlanDraft: m.build }));
vi.mock("@/lib/laundry/sync-draft", () => ({ notifyLaundryTeamsForApprovedSyncDraft: m.notify, clearPendingLaundrySyncDraft: m.clear, getPendingLaundrySyncDraft: vi.fn(), summarizePendingLaundrySyncDraft: vi.fn() }));
const item = { jobId: "changed", propertyId: "property", propertyName: "House", cleanDate: "2026-10-03T00:00:00.000Z", pickupDate: "2026-10-03T00:00:00.000Z", dropoffDate: "2026-10-04T00:00:00.000Z", status: "PENDING", flagReason: null, flagNotes: null, scenario: "KEY_LOST", linenBufferSets: 1 };
const post = (body: object) => POST(new NextRequest("http://localhost/api/admin/laundry/generate-week", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { vi.clearAllMocks(); m.apply.mockResolvedValue([{ jobId: "changed" }]); m.build.mockResolvedValue([item]); });
it("accepts key-lost plans and notifies only rows actually changed by approval", async () => {
  const result = await post({ approve: true, items: [item, { ...item, jobId: "suppressed" }], notifyLaundryAfterApproval: true, clearPendingSyncDraft: true });
  expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ appliedCount: 1 });
  expect(m.notify).toHaveBeenCalledWith([expect.objectContaining({ jobId: "changed", scenario: "KEY_LOST" })]); expect(m.clear).toHaveBeenCalledOnce();
});
it("does not re-notify unchanged or protected tasks on repeated approval", async () => {
  m.apply.mockResolvedValue([]);
  expect((await post({ approve: true, items: [item], notifyLaundryAfterApproval: true })).status).toBe(200);
  expect(m.notify).toHaveBeenCalledWith([]);
});
it("computes the preview without approving or notifying", async () => {
  expect((await post({ weekStart: item.cleanDate })).status).toBe(200);
  expect(m.build).toHaveBeenCalledWith(new Date(item.cleanDate)); expect(m.apply).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
it("does not notify or clear pending work after a failed approval", async () => {
  m.apply.mockRejectedValueOnce(new Error("transaction failed"));
  expect((await post({ approve: true, items: [item], notifyLaundryAfterApproval: true, clearPendingSyncDraft: true })).status).toBe(400);
  expect(m.notify).not.toHaveBeenCalled(); expect(m.clear).not.toHaveBeenCalled();
});
