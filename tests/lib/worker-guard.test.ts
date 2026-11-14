// @vitest-environment node
/**
 * Worker hygiene (sending safeguards, 2026-11-15): a throwing job is never
 * retried by pg-boss, a job retried three times through its own receipts
 * sends once, the next tick of a job still running is skipped, and a job that
 * keeps failing alerts administrators once rather than on every run.
 */
import { describe, expect, it, vi } from "vitest";
import { FAILURE_ALERT_AFTER, createWorkerGuard } from "@/lib/ops/worker-guard";

function deps() {
  return {
    log: { warn: vi.fn(), error: vi.fn() },
    recordRun: vi.fn(),
    recordFailure: vi.fn(),
    raiseFailure: vi.fn(async () => undefined),
    resolveFailure: vi.fn(async () => undefined),
  };
}

describe("createWorkerGuard", () => {
  it("swallows a failure (pg-boss completes the job, no fast retry loop) and alerts once after repeated failures", async () => {
    const d = deps();
    const guard = createWorkerGuard(d);
    const handler = guard.safeHandler("tomorrow-prep-dispatch", async () => { throw new Error("database unavailable"); }, 1_000);
    for (let run = 0; run < FAILURE_ALERT_AFTER + 4; run += 1) await expect(handler()).resolves.toBeUndefined();
    expect(d.raiseFailure).toHaveBeenCalledTimes(1);
    expect(d.raiseFailure).toHaveBeenCalledWith("tomorrow-prep-dispatch", FAILURE_ALERT_AFTER, "Error: database unavailable");
    expect(d.recordFailure).toHaveBeenCalledTimes(FAILURE_ALERT_AFTER + 4);
  });

  it("closes the failure incident when the job succeeds again, and can alert again after a new streak", async () => {
    const d = deps();
    const guard = createWorkerGuard(d);
    let fail = true;
    const handler = guard.safeHandler("ical-sync", async () => { if (fail) throw new Error("boom"); }, 1_000);
    for (let run = 0; run < FAILURE_ALERT_AFTER; run += 1) await handler();
    fail = false;
    await handler();
    expect(d.resolveFailure).toHaveBeenCalledWith("ical-sync");
    fail = true;
    for (let run = 0; run < FAILURE_ALERT_AFTER; run += 1) await handler();
    expect(d.raiseFailure).toHaveBeenCalledTimes(2);
  });

  it("skips the next tick of a job whose earlier run is still going after its timeout", async () => {
    const d = deps();
    const guard = createWorkerGuard(d);
    let release: () => void = () => undefined;
    const sends = vi.fn();
    const handler = guard.safeHandler("reminder-dispatch", () => new Promise<void>((resolve) => { sends(); release = resolve; }), 20);
    await handler(); // times out; the work keeps running
    expect(guard.isRunning("reminder-dispatch")).toBe(true);
    await handler(); // skipped: never two copies of one sweep sending side by side
    expect(sends).toHaveBeenCalledTimes(1);
    expect(d.recordRun).toHaveBeenLastCalledWith(expect.objectContaining({ skipped: true }));
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guard.isRunning("reminder-dispatch")).toBe(false);
  });

  it("a job retried three times sends once through its send-once receipt", async () => {
    const d = deps();
    const guard = createWorkerGuard(d);
    const receipts = new Set<string>();
    const provider = vi.fn();
    const handler = guard.safeHandler("daily-ops-briefing", async () => {
      const key = "briefing:2026-11-15:admin";
      // The receipt is claimed before the send; the run then fails afterwards.
      if (!receipts.has(key)) {
        receipts.add(key);
        provider();
      }
      throw new Error("failed after sending");
    }, 1_000);
    for (let retry = 0; retry < 3; retry += 1) await handler();
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
