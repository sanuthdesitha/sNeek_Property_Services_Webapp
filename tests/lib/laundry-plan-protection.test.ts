// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { applyLaundryPlanDraft } from "@/lib/laundry/planner";
const m = vi.hoisted(() => ({ current: {} as any, upsert: vi.fn(), locks: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (work: any) => work({ $queryRaw: m.locks, laundryTask: { findUnique: async () => m.current, upsert: m.upsert } }) } }));
const item = { jobId: "j", propertyId: "p", pickupDate: "2026-10-03T00:00:00Z", dropoffDate: "2026-10-04T00:00:00Z", status: "PENDING", flagReason: null, flagNotes: null } as any;
beforeEach(() => { vi.clearAllMocks(); m.current = { id: "task", status: "PENDING", confirmations: [] }; m.upsert.mockResolvedValue({ id: "task" }); });
it.each(["PICKED_UP", "DROPPED", "SKIPPED_PICKUP"])("does not rewrite human handoff dates or proof for %s", async status => {
  m.current = { ...m.current, status };
  await applyLaundryPlanDraft([item]); expect(m.locks).toHaveBeenCalledTimes(2); expect(m.upsert).not.toHaveBeenCalled();
});
it("preserves a failed-pickup approval request after a plan refresh", async () => {
  m.current = { ...m.current, status: "FLAGGED", confirmations: [{ id: "failed-pickup-receipt" }] };
  await applyLaundryPlanDraft([item]); expect(m.upsert).not.toHaveBeenCalled();
});
it("preserves confirmation and prior notification flag while approving date updates", async () => {
  m.current = { ...m.current, status: "CONFIRMED", notifyLaundry: true };
  await applyLaundryPlanDraft([item]);
  const update = m.upsert.mock.calls[0][0].update;
  expect(update).not.toHaveProperty("status"); expect(update).not.toHaveProperty("notifyLaundry");
  expect(update.pickupDate).toEqual(new Date(item.pickupDate));
});

it("returns no changed rows when an identical plan is approved twice", async () => {
  m.current = { ...m.current, pickupDate: new Date(item.pickupDate), dropoffDate: new Date(item.dropoffDate), flagReason: null, flagNotes: null };
  expect(await applyLaundryPlanDraft([item])).toEqual([]); expect(m.upsert).not.toHaveBeenCalled();
});

it("does not lock or write for an empty approval", async () => {
  expect(await applyLaundryPlanDraft([])).toEqual([]);
  expect(m.locks).not.toHaveBeenCalled();
});
it("creates a new draft task without enabling notifications", async () => {
  m.current = null;
  expect(await applyLaundryPlanDraft([item])).toEqual([{ id: "task" }]);
  expect(m.upsert.mock.calls[0][0].create).toMatchObject({ jobId: "j", status: "PENDING", notifyLaundry: false });
});
it.each(["pickedUpAt", "droppedAt"])("retains physical handoff evidence despite stale PENDING state (%s)", async field => {
  m.current[field] = new Date();
  expect(await applyLaundryPlanDraft([item])).toEqual([]);
  expect(m.upsert).not.toHaveBeenCalled();
});
it("does not overwrite human status or flags when dates already match", async () => {
  m.current = { ...m.current, status: "CONFIRMED", pickupDate: new Date(item.pickupDate), dropoffDate: new Date(item.dropoffDate), flagNotes: "human note" };
  expect(await applyLaundryPlanDraft([item])).toEqual([]);
  expect(m.upsert).not.toHaveBeenCalled();
});
it.each([
  { status: "FLAGGED", flagReason: "KEY_LOST", flagNotes: null },
  { status: "PENDING", flagReason: "KEY_LOST", flagNotes: null },
  { status: "PENDING", flagReason: null, flagNotes: "updated note" },
])("updates planner-owned flags even when dates match: %j", async draft => {
  m.current = { ...m.current, pickupDate: new Date(item.pickupDate), dropoffDate: new Date(item.dropoffDate) };
  await applyLaundryPlanDraft([{ ...item, ...draft }]);
  expect(m.upsert.mock.calls[0][0].update).toMatchObject(draft);
});
it("treats absent and null draft flags identically on repeated approval", async () => {
  m.current = { ...m.current, pickupDate: new Date(item.pickupDate), dropoffDate: new Date(item.dropoffDate) };
  expect(await applyLaundryPlanDraft([{ ...item, flagReason: undefined, flagNotes: undefined }])).toEqual([]);
});
