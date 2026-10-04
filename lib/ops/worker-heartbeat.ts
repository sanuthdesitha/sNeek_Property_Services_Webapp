import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
export const WORKER_HEARTBEAT_PREFIX = "opsWorkerHeartbeat:";
const STALE_AFTER_MS = 3 * 60_000;
export type WorkerHealth = { status: "ACTIVE" | "STALE" | "MISSING"; lastSeenAt: string | null; mobileDispatcherActive: boolean };

/** Pure read model: a schedule row is not proof of a live worker. */
export function summarizeWorkerHeartbeats(rows: Array<{ value: unknown; updatedAt: Date }>, now = new Date()): WorkerHealth {
  const known = rows.filter(row => Number.isFinite(row.updatedAt?.getTime()));
  const live = known.filter(row => now.getTime() - row.updatedAt.getTime() < STALE_AFTER_MS);
  const latest = known.reduce<Date | null>((result, row) => !result || row.updatedAt > result ? row.updatedAt : result, null);
  return { status: live.length ? "ACTIVE" : known.length ? "STALE" : "MISSING", lastSeenAt: latest?.toISOString() ?? null,
    mobileDispatcherActive: live.some(row => (row.value as { mobileDispatcherEnabled?: boolean } | null)?.mobileDispatcherEnabled === true) };
}

/** Explicitly called after worker registration; importing this module is inert. */
export async function startWorkerHeartbeat(mobileDispatcherEnabled: boolean) {
  const key = WORKER_HEARTBEAT_PREFIX + randomUUID();
  const value = { mobileDispatcherEnabled };
  const tick = async () => {
    await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value, updatedAt: new Date() } });
  };
  await tick();
  let writing = false;
  const timer = setInterval(() => {
    if (writing) return;
    writing = true;
    void tick().catch(error => logger.error({ err: error }, "Worker heartbeat failed")).finally(() => { writing = false; });
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
