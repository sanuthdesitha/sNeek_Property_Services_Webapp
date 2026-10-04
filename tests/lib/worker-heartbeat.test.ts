// @vitest-environment node
import { expect, it, vi } from "vitest";
import { summarizeWorkerHeartbeats, startWorkerHeartbeat } from "@/lib/ops/worker-heartbeat";
const m = vi.hoisted(() => ({ upsert: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { upsert: m.upsert } } }));
const now = new Date("2026-10-03T00:00:00Z");
it("distinguishes missing, stale, live and disabled workers without writing", () => {
  expect(summarizeWorkerHeartbeats([], now).status).toBe("MISSING");
  const stale = { value: { mobileDispatcherEnabled: true }, updatedAt: new Date(now.getTime() - 240000) };
  expect(summarizeWorkerHeartbeats([stale], now).status).toBe("STALE");
  const live = { value: { mobileDispatcherEnabled: false }, updatedAt: now };
  expect(summarizeWorkerHeartbeats([stale, live], now)).toMatchObject({ status: "ACTIVE", mobileDispatcherActive: false });
  expect(summarizeWorkerHeartbeats([stale, live, { ...live, value: { mobileDispatcherEnabled: true } }], now).mobileDispatcherActive).toBe(true);
  expect(m.upsert).not.toHaveBeenCalled();
});
it("writes only when explicitly started by the worker and refreshes every minute", async () => {
  vi.useFakeTimers(); m.upsert.mockClear();
  const stop = await startWorkerHeartbeat(true);
  expect(m.upsert).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000); expect(m.upsert).toHaveBeenCalledTimes(2);
  stop(); await vi.advanceTimersByTimeAsync(60000); expect(m.upsert).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
