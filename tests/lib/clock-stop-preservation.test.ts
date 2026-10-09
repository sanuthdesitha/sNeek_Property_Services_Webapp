// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { clockOutCleaner } from "@/lib/jobs/clock";
it.each([0, 1])("only advances the stop flow if this request closes the segment (%s)", async count => {
 const now = new Date();
 const tx: any = { $queryRaw: vi.fn(), timeLog: { findFirst: vi.fn().mockResolvedValue({ id: "clock", startedAt: new Date(now.getTime() - 600_000) }), updateMany: vi.fn().mockResolvedValue({ count }) }, job: { updateMany: vi.fn() } };
 const result = await clockOutCleaner({ jobId: "job", userId: "cleaner", now, tx });
 expect(tx.timeLog.updateMany).toHaveBeenCalledWith({ where: { id: "clock", stoppedAt: null }, data: { stoppedAt: now, durationM: 10 } });
 expect(result.stopped).toBe(count === 1);
 if (count) expect(result.clockOut).toEqual({ timeLogId: "clock", stoppedAt: now.toISOString() });
 else { expect(result.clockOut).toBeUndefined(); expect(tx.job.updateMany).not.toHaveBeenCalled(); }
});
it("never rewrites an already stopped clock", async () => {
 const tx: any = { $queryRaw: vi.fn(), timeLog: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() } };
 expect(await clockOutCleaner({ jobId: "job", userId: "cleaner", tx })).toEqual({ stopped: false, durationM: 0 });
 expect(tx.timeLog.updateMany).not.toHaveBeenCalled();
});
