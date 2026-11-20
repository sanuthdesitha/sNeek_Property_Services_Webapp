import "server-only";
/**
 * Provider sync and the scheduled device check (2026-11-20).
 *
 * The worker job `property-devices` (workers/boss.ts, hourly) calls
 * runPropertyDeviceChecks: each connected provider is polled when its interval
 * (default 6 hours) has passed; then every active battery device is evaluated
 * (manual devices included, so the manual fallback always works), open charge
 * tasks are kept on the next available clean, and cleaners on a clean that now
 * carries a charge task are told once.
 *
 * One run at a time per provider: a lease on the connection row (compare and
 * set, with expiry). Idempotent: devices are upserted on (provider, external
 * id); a reading with the same provider time as the stored one is not
 * recorded twice; tasks are created under the device row lock.
 *
 * Failure is loud: the connection keeps the last error in words, the time of
 * the last good sync and a failure count; after N failures (default 3) or a
 * refused sign-in, administrators are told once per outage. Readings are never
 * refreshed by a failed sync, so they age into "out of date" on their own.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { safeReason } from "@/lib/xero/token-service";
import { evaluateDevice, notifyLandedTasks, recordReading, rehomeChargeTasks } from "./charge-service";
import { getMinutCredentials, persistRotatedRingToken, readRingSecret } from "./connections";
import { defaultFetchDeps, ProviderHttpError, type ProviderFetchDeps } from "./providers/http";
import { minutReadSnapshot } from "./providers/minut-client";
import { ringReadSnapshot } from "./providers/ring-client";
import type { ProviderSnapshot } from "./providers/types";
import { readPropertyDeviceSettings } from "./settings";
import { DEVICE_CHARGE_TASK_KIND, type ConnectedProvider, type PropertyDeviceSettings } from "./types";

const LEASE_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

export type SyncMode = "AUTO" | "MANUAL";

export type SyncSummary = {
  locations: number;
  linkedLocations: number;
  devicesSeen: number;
  devicesAdded: number;
  readingsRecorded: number;
  tasksRaised: number;
};

export type SyncResult =
  | { status: "SUCCESS"; runId: string; summary: SyncSummary }
  | { status: "ERROR"; runId: string; error: string }
  | { status: "SKIPPED"; reason: string };

export type SyncDeps = { fetch: ProviderFetchDeps; now: () => Date; notifyFailure: (input: { provider: ConnectedProvider; connectionId: string; reason: string; lastSuccessAt: Date | null; outageStartedAt: Date }) => Promise<void> };

function defaultSyncDeps(): SyncDeps {
  return {
    fetch: defaultFetchDeps(),
    now: () => new Date(),
    notifyFailure: async (input) => {
      const { sendProviderFailingNotice } = await import("./notices");
      await sendProviderFailingNotice({ ...input, timeZone: (await getAppSettings()).timezone || "Australia/Sydney" });
    },
  };
}

async function acquireLease(provider: ConnectedProvider, now: Date): Promise<string | null> {
  const token = randomUUID();
  const updated = await db.deviceProviderConnection.updateMany({
    where: { provider, status: "CONNECTED", OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }] },
    data: { syncLeaseToken: token, syncLeaseUntil: new Date(now.getTime() + LEASE_MS), lastSyncStartedAt: now },
  });
  return updated.count === 1 ? token : null;
}

async function releaseLease(provider: ConnectedProvider, token: string, data: Prisma.DeviceProviderConnectionUpdateManyMutationInput): Promise<void> {
  await db.deviceProviderConnection.updateMany({ where: { provider, syncLeaseToken: token }, data: { ...data, syncLeaseToken: null, syncLeaseUntil: null } });
}

async function readSnapshot(provider: ConnectedProvider, deps: SyncDeps): Promise<ProviderSnapshot> {
  if (provider === "MINUT") {
    const credentials = await getMinutCredentials();
    if (!credentials.clientId || !credentials.clientSecret) throw new ProviderHttpError("Minut's API client id or secret is missing.", null, "auth");
    return minutReadSnapshot(deps.fetch, credentials);
  }
  const secret = await readRingSecret();
  if (!secret) throw new ProviderHttpError("The stored Ring sign-in could not be read (missing, or ENCRYPTION_KEY changed). Reconnect Ring.", null, "auth");
  let version = secret.tokenVersion;
  return ringReadSnapshot(deps.fetch, {
    refreshToken: secret.refreshToken,
    hardwareId: secret.hardwareId,
    persistRotated: async (next) => {
      version = await persistRotatedRingToken(version, next);
    },
    now: deps.now,
  });
}

/** Store locations and the devices of linked locations; record new readings. */
async function applySnapshot(provider: ConnectedProvider, snapshot: ProviderSnapshot, now: Date, settings: PropertyDeviceSettings): Promise<SyncSummary> {
  for (const location of snapshot.locations) {
    await db.deviceProviderLocation.upsert({
      where: { provider_externalLocationId: { provider, externalLocationId: location.externalLocationId } },
      create: { provider, externalLocationId: location.externalLocationId, name: location.name, address: location.address, lastSeenAt: now },
      update: { name: location.name, address: location.address, lastSeenAt: now },
    });
  }
  const links = await db.deviceProviderLocation.findMany({ where: { provider, propertyId: { not: null }, confirmedAt: { not: null } }, select: { externalLocationId: true, propertyId: true } });
  const propertyByLocation = new Map(links.map((link) => [link.externalLocationId, link.propertyId as string]));
  const summary: SyncSummary = { locations: snapshot.locations.length, linkedLocations: links.length, devicesSeen: 0, devicesAdded: 0, readingsRecorded: 0, tasksRaised: 0 };

  for (const device of snapshot.devices) {
    const propertyId = device.externalLocationId ? propertyByLocation.get(device.externalLocationId) : undefined;
    if (!propertyId) continue;
    summary.devicesSeen += 1;
    const existing = await db.propertyDevice.findUnique({
      where: { provider_externalDeviceId: { provider, externalDeviceId: device.externalDeviceId } },
      select: { id: true, lastReadingAt: true, lastReadingSource: true },
    });
    const row = existing
      ? await db.propertyDevice.update({
          where: { id: existing.id },
          data: { propertyId, externalLocationId: device.externalLocationId, online: device.online, onlineCheckedAt: now },
          select: { id: true, lastReadingAt: true, lastReadingSource: true },
        })
      : await db.propertyDevice.create({
          data: {
            propertyId, provider, externalDeviceId: device.externalDeviceId, externalLocationId: device.externalLocationId,
            name: device.name, kind: device.kind, batteryPowered: device.batteryPowered, online: device.online, onlineCheckedAt: now,
          },
          select: { id: true, lastReadingAt: true, lastReadingSource: true },
        });
    if (!existing) summary.devicesAdded += 1;
    const sameReading = row.lastReadingSource === "PROVIDER" && device.readAt && row.lastReadingAt?.getTime() === device.readAt.getTime();
    if (device.batteryPercent !== null && device.readAt && !sameReading) {
      const recorded = await recordReading({ deviceId: row.id, percent: device.batteryPercent, source: "PROVIDER", readAt: device.readAt, recordedById: null }, { now, settings });
      summary.readingsRecorded += 1;
      if (recorded.outcome.createdTaskId) summary.tasksRaised += 1;
    }
  }
  return summary;
}

async function recordFailure(provider: ConnectedProvider, token: string, error: unknown, now: Date, settings: PropertyDeviceSettings, deps: SyncDeps): Promise<string> {
  const reason = error instanceof ProviderHttpError ? error.message : safeReason(error instanceof Error ? error.message : String(error));
  const needsReconnect = error instanceof ProviderHttpError && error.kind === "auth";
  await releaseLease(provider, token, {
    lastError: reason,
    lastErrorAt: now,
    consecutiveFailures: { increment: 1 },
    ...(needsReconnect ? { status: "NEEDS_RECONNECT", ...(provider === "RING" ? { refreshToken: null } : {}) } : {}),
  });
  const row = await db.deviceProviderConnection.findUnique({ where: { provider }, select: { id: true, consecutiveFailures: true, lastSuccessAt: true, failureNoticeAt: true } });
  if (row && !row.failureNoticeAt && (needsReconnect || row.consecutiveFailures >= settings.failureNoticeAfter)) {
    // Claim the notice for this outage before sending, so a second worker or retry never sends it again.
    const claimed = await db.deviceProviderConnection.updateMany({ where: { id: row.id, failureNoticeAt: null }, data: { failureNoticeAt: now } });
    if (claimed.count === 1) {
      await deps.notifyFailure({ provider, connectionId: row.id, reason, lastSuccessAt: row.lastSuccessAt, outageStartedAt: now }).catch((err) => logger.error({ err: safeReason(String(err)), provider }, "property devices: failure notice not sent"));
    }
  }
  return reason;
}

/** One provider sync. AUTO runs only when the poll interval has passed. */
export async function runProviderSync(provider: ConnectedProvider, options: { mode: SyncMode; triggeredById?: string | null; settings?: PropertyDeviceSettings; deps?: Partial<SyncDeps> } ): Promise<SyncResult> {
  const deps = { ...defaultSyncDeps(), ...options.deps };
  const now = deps.now();
  const settings = options.settings ?? (await readPropertyDeviceSettings());
  const connection = await db.deviceProviderConnection.findUnique({ where: { provider }, select: { status: true, lastSyncStartedAt: true } });
  if (!connection || connection.status !== "CONNECTED") return { status: "SKIPPED", reason: `${provider === "RING" ? "Ring" : "Minut"} is not connected.` };
  if (options.mode === "AUTO" && connection.lastSyncStartedAt && now.getTime() - connection.lastSyncStartedAt.getTime() < settings.pollIntervalHours * HOUR_MS) {
    return { status: "SKIPPED", reason: "Not due yet." };
  }
  const token = await acquireLease(provider, now);
  if (!token) return { status: "SKIPPED", reason: "A sync for this provider is already running." };
  const run = await db.deviceSyncRun.create({ data: { provider, mode: options.mode, status: "RUNNING", triggeredById: options.triggeredById ?? null }, select: { id: true } });
  try {
    const snapshot = await readSnapshot(provider, deps);
    const summary = await applySnapshot(provider, snapshot, now, settings);
    await releaseLease(provider, token, { lastSuccessAt: deps.now(), lastError: null, consecutiveFailures: 0, failureNoticeAt: null });
    await db.deviceSyncRun.update({ where: { id: run.id }, data: { status: "SUCCESS", summary: summary as unknown as Prisma.InputJsonValue, completedAt: deps.now() } });
    return { status: "SUCCESS", runId: run.id, summary };
  } catch (error) {
    const reason = await recordFailure(provider, token, error, now, settings, deps);
    await db.deviceSyncRun.update({ where: { id: run.id }, data: { status: "ERROR", error: reason, completedAt: deps.now() } });
    return { status: "ERROR", runId: run.id, error: reason };
  }
}

export type DeviceCheckSummary = {
  providers: Record<ConnectedProvider, SyncResult["status"]>;
  devicesEvaluated: number;
  tasksRaised: number;
  tasksMoved: number;
  cleanersTold: number;
  failures: number;
};

/** The hourly check (worker job `property-devices`). */
export async function runPropertyDeviceChecks(options: { now?: Date; deps?: Partial<SyncDeps> } = {}): Promise<DeviceCheckSummary> {
  const settings = await readPropertyDeviceSettings();
  const timeZone = (await getAppSettings()).timezone || "Australia/Sydney";
  const summary: DeviceCheckSummary = { providers: { RING: "SKIPPED", MINUT: "SKIPPED" }, devicesEvaluated: 0, tasksRaised: 0, tasksMoved: 0, cleanersTold: 0, failures: 0 };
  for (const provider of ["RING", "MINUT"] as const) {
    const result = await runProviderSync(provider, { mode: "AUTO", settings, deps: options.deps });
    summary.providers[provider] = result.status;
  }
  const now = options.now ?? new Date();
  const devices = await db.propertyDevice.findMany({ where: { isActive: true, batteryPowered: true }, select: { id: true } });
  for (const device of devices) {
    try {
      const outcome = await evaluateDevice(device.id, { now, settings, timeZone });
      summary.devicesEvaluated += 1;
      if (outcome.createdTaskId) summary.tasksRaised += 1;
    } catch (err) {
      summary.failures += 1;
      logger.error({ err, deviceId: device.id }, "property devices: evaluation failed");
    }
  }
  const landed = await db.$transaction((tx) => rehomeChargeTasks(tx, { timeZone, now }));
  summary.tasksMoved = landed.length;
  await notifyLandedTasks(landed);
  summary.cleanersTold = await notifyOpenTasksOnJobs();
  await db.deviceSyncRun.create({ data: { provider: null, mode: "AUTO", status: summary.failures ? "ERROR" : "SUCCESS", summary: summary as unknown as Prisma.InputJsonValue, completedAt: new Date(), ...(summary.failures ? { error: `${summary.failures} device check${summary.failures === 1 ? "" : "s"} failed; see the worker log.` } : {}) } });
  return summary;
}

/**
 * Charge tasks put on a clean by the existing attach hooks (assignment, iCal
 * sync, the property's pending tasks) are told to the cleaners here; each
 * task, clean and cleaner is told once.
 */
async function notifyOpenTasksOnJobs(): Promise<number> {
  const { notifyDeviceChargeTask } = await import("./notices");
  const tasks = await db.jobTask.findMany({
    where: { executionStatus: "OPEN", jobId: { not: null }, visibleToCleaner: true, metadata: { path: ["kind"], equals: DEVICE_CHARGE_TASK_KIND } },
    select: { id: true },
  });
  let told = 0;
  for (const task of tasks) {
    told += await notifyDeviceChargeTask(task.id).catch((err) => {
      logger.error({ err, taskId: task.id }, "property devices: charge notice failed");
      return 0;
    });
  }
  return told;
}
