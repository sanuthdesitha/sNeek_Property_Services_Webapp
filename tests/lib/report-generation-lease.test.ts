// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), read: vi.fn(), upsert: vi.fn(), remove: vi.fn(), job: vi.fn(), rowLock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction, appSetting: { deleteMany: m.remove } } }));
import { withReportGeneration } from "@/lib/reports/generation-lease";
let row: any;
const updatedAt = new Date("2026-10-03T00:00:00Z");
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => {
 vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(updatedAt); row = null;
 m.read.mockImplementation(async () => row ? { value: { ...row } } : null);
 m.upsert.mockImplementation(async ({ create }) => { row = { ...create.value }; });
 m.remove.mockImplementation(async ({ where }) => { if (row?.token === where.value.equals) { row = null; return { count: 1 }; } return { count: 0 }; });
 m.job.mockResolvedValue({ updatedAt });
 m.transaction.mockImplementation(async fn => fn({ $executeRaw: m.lock, $queryRaw: m.rowLock, appSetting: { findUnique: m.read, upsert: m.upsert }, job: { findUnique: m.job } }));
});
afterEach(() => vi.useRealTimers());
it("rejects a concurrent same-job producer before rendering", async () => {
 const ready = deferred(); const finish = deferred(); const renderSecond = vi.fn();
 const first = withReportGeneration("job", async ({ publish }) => { ready.resolve(); await finish.promise; await publish(updatedAt, async () => {}); });
 await ready.promise;
 await expect(withReportGeneration("job", renderSecond)).rejects.toThrow("already running");
 expect(renderSecond).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
 finish.resolve(); await first; expect(row).toBeNull();
});
it("fences expired workers from publication AND from releasing replacement leases", async () => {
 const oldReady = deferred(); const oldFinish = deferred(); const newReady = deferred(); const newFinish = deferred();
 const oldWrite = vi.fn(); const newWrite = vi.fn(); const keys: string[] = [];
 const first = withReportGeneration("job", async ({ publish, storageId }) => { keys.push(storageId); oldReady.resolve(); await oldFinish.promise; await publish(updatedAt, oldWrite); });
 await oldReady.promise; vi.setSystemTime(new Date(updatedAt.getTime() + 6 * 60_000));
 const second = withReportGeneration("job", async ({ publish, storageId }) => { keys.push(storageId); newReady.resolve(); await newFinish.promise; await publish(updatedAt, newWrite); });
 await newReady.promise;
 const denied = expect(first).rejects.toThrow("superseded"); oldFinish.resolve(); await denied;
 expect(oldWrite).not.toHaveBeenCalled(); expect(row.token).toBe(keys[1]); expect(keys[0]).not.toBe(keys[1]);
 newFinish.resolve(); await second; expect(newWrite).toHaveBeenCalledOnce(); expect(row).toBeNull();
});
it("rejects a report whose job changed while it was rendering", async () => {
 const write = vi.fn(); m.job.mockResolvedValue({ updatedAt: new Date(updatedAt.getTime() + 1) });
 await expect(withReportGeneration("job", async ({ publish }) => publish(updatedAt, write))).rejects.toThrow("Job changed");
 expect(write).not.toHaveBeenCalled(); expect(row).toBeNull();
});
it("rejects deleted jobs and releases failed render leases", async () => {
 m.job.mockResolvedValue(null);
 await expect(withReportGeneration("job", async ({ publish }) => publish(updatedAt, vi.fn()))).rejects.toThrow("Job changed");
 await expect(withReportGeneration("job", async () => { throw new Error("render failed"); })).rejects.toThrow("render failed");
 expect(row).toBeNull();
});
