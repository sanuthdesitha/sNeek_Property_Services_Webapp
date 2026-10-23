import { db } from "@/lib/db";
import { summarizeWorkerHeartbeats, WORKER_HEARTBEAT_PREFIX, type WorkerHealth } from "@/lib/ops/worker-heartbeat";

export type IcalRunStatus = {
  id: string;
  propertyId: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
};
export type IcalAutomationStatus = {
  worker: WorkerHealth | null;
  recentAutoRuns: IcalRunStatus[] | null;
  latestManualRun: IcalRunStatus | null;
  historyAvailable: boolean;
};

/** Shared, read-only evidence. A manual run or stored cron is not worker health. */
export async function readIcalAutomationStatus(now = new Date()): Promise<IcalAutomationStatus> {
  const select = { id: true, propertyId: true, status: true, createdAt: true, completedAt: true } as const;
  const [heartbeats, automatic, manual] = await Promise.allSettled([
    db.appSetting.findMany({
      where: { key: { startsWith: WORKER_HEARTBEAT_PREFIX } },
      select: { value: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 100,
    }),
    db.icalSyncRun.findMany({ where: { mode: "AUTO" }, select, orderBy: { createdAt: "desc" }, take: 20 }),
    db.icalSyncRun.findFirst({ where: { mode: "MANUAL" }, select, orderBy: { createdAt: "desc" } }),
  ]);
  const serialize = (row: { id: string; propertyId: string; status: string; createdAt: Date; completedAt: Date | null }): IcalRunStatus => ({
    ...row, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
  });
  return {
    worker: heartbeats.status === "fulfilled" ? summarizeWorkerHeartbeats(heartbeats.value, now) : null,
    recentAutoRuns: automatic.status === "fulfilled" ? automatic.value.map(serialize) : null,
    latestManualRun: manual.status === "fulfilled" && manual.value ? serialize(manual.value) : null,
    historyAvailable: automatic.status === "fulfilled" && manual.status === "fulfilled",
  };
}
