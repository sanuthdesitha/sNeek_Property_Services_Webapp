// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ heartbeats: vi.fn(), auto: vi.fn(), manual: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  appSetting: { findMany: m.heartbeats }, icalSyncRun: { findMany: m.auto, findFirst: m.manual },
} }));
import { readIcalAutomationStatus } from "@/lib/ical/automation-status";
const now = new Date("2026-10-23T00:00:00Z");
const manual = { id: "manual", propertyId: "property", status: "SUCCESS", createdAt: now, completedAt: now };
beforeEach(() => {
  vi.resetAllMocks(); m.heartbeats.mockResolvedValue([]); m.auto.mockResolvedValue([]); m.manual.mockResolvedValue(manual);
});
it("never uses recent manual success as evidence of unattended execution", async () => {
  const status = await readIcalAutomationStatus(now);
  expect(status).toMatchObject({ worker: { status: "MISSING", icalSyncActive: false }, recentAutoRuns: [], latestManualRun: { id: "manual" }, historyAvailable: true });
  expect(m.auto).toHaveBeenCalledWith(expect.objectContaining({ where: { mode: "AUTO" } }));
  expect(m.manual).toHaveBeenCalledWith(expect.objectContaining({ where: { mode: "MANUAL" } }));
});
it("preserves AUTO errors and timestamps independently of a live handler", async () => {
  m.heartbeats.mockResolvedValue([{ value: { registeredJobs: ["ical-sync"] }, updatedAt: now }]);
  m.auto.mockResolvedValue([{ ...manual, id: "auto", status: "ERROR", completedAt: null }]);
  const status = await readIcalAutomationStatus(now);
  expect(status.worker?.icalSyncActive).toBe(true);
  expect(status.recentAutoRuns).toEqual([{ id: "auto", propertyId: "property", status: "ERROR", createdAt: now.toISOString(), completedAt: null }]);
});
it("distinguishes unavailable reads from missing workers and empty history", async () => {
  m.heartbeats.mockRejectedValue(new Error("unavailable"));
  m.auto.mockRejectedValue(new Error("unavailable"));
  m.manual.mockRejectedValue(new Error("unavailable"));
  expect(await readIcalAutomationStatus(now)).toEqual({ worker: null, recentAutoRuns: null, latestManualRun: null, historyAvailable: false });
});
