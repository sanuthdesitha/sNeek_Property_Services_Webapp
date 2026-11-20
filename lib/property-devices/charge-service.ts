import "server-only";
/**
 * Low battery → one enforced charge task on the next available clean
 * (2026-11-20).
 *
 * Every decision runs in one transaction holding the device row lock (SELECT …
 * FOR UPDATE), and the task id is derived from the device and its raise count,
 * so concurrent sync runs, retries and a manual reading at the same moment
 * still produce exactly one task per raise.
 *
 * This module only ADDS tasks to jobs that already exist. It never creates,
 * moves or reprioritises a job, and does not touch lib/scheduling-rules.
 */
import { JobStatus, type Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { createOfficeJobTask } from "@/lib/job-tasks/service";
import { NOT_UPCOMING_STATUSES } from "@/lib/lost-found/return-upcoming";
import { chargeTaskTitle, decideCharge, effectiveThreshold, isPercent, type ChargeDecision } from "./charge-policy";
import { readPropertyDeviceSettings } from "./settings";
import { DEVICE_CHARGE_TASK_KIND, KIND_LABEL, PROVIDER_LABEL, type DeviceChargeTaskMetadata, type DeviceKind, type DeviceProvider, type PropertyDeviceSettings, type ReadingSource } from "./types";

type Tx = Prisma.TransactionClient;

/** A submitted job decides its own tasks in the submission. */
const SUBMITTED_STATUSES: JobStatus[] = [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED];

export type UpcomingJob = { id: string; jobNumber: string | null; scheduledDate: Date };

/**
 * The next available clean at a property: not cancelled, not finished, not
 * skipped, scheduled today or later in the organisation calendar (the same
 * rule as the lost and found pickup picker; `scheduledDate` is the calendar
 * day stored at UTC midnight, read unshifted).
 */
export async function nextUpcomingJob(reader: Pick<Tx, "job">, propertyId: string, timeZone: string, now: Date = new Date()): Promise<UpcomingJob | null> {
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  return reader.job.findFirst({
    where: {
      propertyId,
      status: { notIn: NOT_UPCOMING_STATUSES },
      scheduledDate: { gte: new Date(`${today}T00:00:00.000Z`) },
      NOT: { cleanSkipStatus: "SKIPPED" },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    select: { id: true, jobNumber: true, scheduledDate: true },
  });
}

export function chargeTaskId(deviceId: string, raiseCount: number): string {
  return `device-charge-${deviceId}-${raiseCount}`;
}

type LockedDevice = {
  id: string;
  propertyId: string;
  provider: DeviceProvider;
  name: string;
  kind: DeviceKind;
  locationNote: string | null;
  batteryPowered: boolean;
  isActive: boolean;
  online: boolean | null;
  lastBatteryPercent: number | null;
  lastReadingAt: Date | null;
  lastReadingSource: ReadingSource | null;
  thresholdPercent: number | null;
  chargeCondition: "NONE" | "NEEDS_CHARGE" | "CHARGED_AWAITING_CONFIRMATION";
  conditionOpenedAt: Date | null;
  chargeTaskId: string | null;
  chargedAt: Date | null;
  raiseCount: number;
  property: { clientId: string | null; deviceBatteryThresholdPercent: number | null };
};

async function lockDevice(tx: Tx, deviceId: string): Promise<LockedDevice | null> {
  await tx.$queryRaw`SELECT "id" FROM "PropertyDevice" WHERE "id" = ${deviceId} FOR UPDATE`;
  return tx.propertyDevice.findUnique({
    where: { id: deviceId },
    select: {
      id: true, propertyId: true, provider: true, name: true, kind: true, locationNote: true, batteryPowered: true, isActive: true, online: true,
      lastBatteryPercent: true, lastReadingAt: true, lastReadingSource: true, thresholdPercent: true,
      chargeCondition: true, conditionOpenedAt: true, chargeTaskId: true, chargedAt: true, raiseCount: true,
      property: { select: { clientId: true, deviceBatteryThresholdPercent: true } },
    },
  }) as Promise<LockedDevice | null>;
}

async function openTaskExists(tx: Tx, taskId: string | null): Promise<boolean> {
  if (!taskId) return false;
  const task = await tx.jobTask.findUnique({ where: { id: taskId }, select: { executionStatus: true } });
  return task?.executionStatus === "OPEN";
}

export type EvaluationOutcome = {
  deviceId: string;
  decision: ChargeDecision;
  /** The task created by this evaluation (null when none was created). */
  createdTaskId: string | null;
  /** The job the created task went on; null means it waits for a clean. */
  createdOnJobId: string | null;
};

type EvaluateOptions = { now?: Date; settings?: PropertyDeviceSettings; timeZone?: string };

async function raiseTask(tx: Tx, device: LockedDevice, percent: number, threshold: number, now: Date, timeZone: string): Promise<{ taskId: string; jobId: string | null }> {
  const raiseCount = device.raiseCount + 1;
  const job = await nextUpcomingJob(tx, device.propertyId, timeZone, now);
  const providerLabel = device.provider === "MANUAL" ? null : PROVIDER_LABEL[device.provider];
  const metadata: DeviceChargeTaskMetadata = {
    kind: DEVICE_CHARGE_TASK_KIND,
    priority: "HIGH",
    deviceId: device.id,
    deviceName: device.name,
    provider: device.provider,
    readingPercent: percent,
    allowNotApplicable: false,
    strictPhoto: true,
  };
  const where = device.locationNote ? ` It is at: ${device.locationNote}.` : "";
  const task = await createOfficeJobTask(tx, {
    id: chargeTaskId(device.id, raiseCount),
    propertyId: device.propertyId,
    clientId: device.property.clientId,
    jobId: job?.id ?? null,
    title: chargeTaskTitle({ providerLabel, kindLabel: KIND_LABEL[device.kind], deviceName: device.name, percent }),
    description: `Battery is at ${percent}% (charge at ${threshold}% or below).${where} Put it on charge, or charge and re-mount it, and take a photo. If you cannot, choose Could not do and say why; the office is told and it moves to the next clean.`,
    requiresPhoto: true,
    requiresNote: false,
    metadata,
    actorUserId: null,
    eventAction: "DEVICE_CHARGE_TASK_CREATED",
    eventNote: `Low battery: ${percent}% (threshold ${threshold}%).`,
  });
  await tx.propertyDevice.update({
    where: { id: device.id },
    data: {
      chargeCondition: "NEEDS_CHARGE",
      conditionOpenedAt: device.chargeCondition === "NEEDS_CHARGE" && device.conditionOpenedAt ? device.conditionOpenedAt : now,
      conditionReadingPercent: percent,
      chargeTaskId: task.id,
      raiseCount,
      conditionClosedAt: null,
      conditionClosedNote: null,
      conditionClosedById: null,
    },
  });
  return { taskId: task.id, jobId: job?.id ?? null };
}

/** Cancel a still-open charge task (the battery recovered, or the office closed it). */
async function cancelOpenTask(tx: Tx, taskId: string | null, actorUserId: string | null, note: string): Promise<void> {
  if (!taskId) return;
  const updated = await tx.jobTask.updateMany({ where: { id: taskId, executionStatus: "OPEN" }, data: { executionStatus: "CANCELLED", visibleToCleaner: false } });
  if (updated.count > 0) {
    await tx.jobTaskEvent.create({ data: { taskId, actorUserId, action: "DEVICE_CHARGE_TASK_CANCELLED", note } });
  }
}

/** Evaluate one device inside an open transaction (the caller holds nothing; this takes the row lock). */
export async function evaluateDeviceInTx(tx: Tx, deviceId: string, options: Required<EvaluateOptions>): Promise<EvaluationOutcome> {
  const device = await lockDevice(tx, deviceId);
  if (!device) return { deviceId, decision: { action: "NONE", reason: "Device not found." }, createdTaskId: null, createdOnJobId: null };
  const threshold = effectiveThreshold({
    deviceThreshold: device.thresholdPercent,
    propertyThreshold: device.property.deviceBatteryThresholdPercent,
    organisationThreshold: options.settings.defaultThresholdPercent,
  });
  const hasOpenTask = await openTaskExists(tx, device.chargeTaskId);
  const decision = decideCharge({
    isActive: device.isActive,
    batteryPowered: device.batteryPowered,
    online: device.online,
    reading: { percent: device.lastBatteryPercent, readAt: device.lastReadingAt, source: device.lastReadingSource },
    thresholdPercent: threshold,
    condition: device.chargeCondition,
    conditionOpenedAt: device.conditionOpenedAt,
    chargedAt: device.chargedAt,
    hasOpenTask,
  }, options.now, options.settings);

  if (decision.action === "RAISE" || decision.action === "ENSURE_TASK") {
    const raised = await raiseTask(tx, device, device.lastBatteryPercent as number, threshold, options.now, options.timeZone);
    return { deviceId, decision, createdTaskId: raised.taskId, createdOnJobId: raised.jobId };
  }
  if (decision.action === "CLOSE_RECOVERED") {
    await cancelOpenTask(tx, device.chargeTaskId, null, decision.reason);
    await tx.propertyDevice.update({
      where: { id: device.id },
      data: { chargeCondition: "NONE", chargeTaskId: null, conditionClosedAt: options.now, conditionClosedNote: decision.reason, conditionClosedById: null },
    });
  }
  return { deviceId, decision, createdTaskId: null, createdOnJobId: null };
}

async function resolveOptions(options: EvaluateOptions): Promise<Required<EvaluateOptions>> {
  return {
    now: options.now ?? new Date(),
    settings: options.settings ?? (await readPropertyDeviceSettings()),
    timeZone: options.timeZone ?? ((await getAppSettings()).timezone || "Australia/Sydney"),
  };
}

/** Evaluate one device in its own transaction, then tell the cleaners about a new task on a job. */
export async function evaluateDevice(deviceId: string, options: EvaluateOptions = {}): Promise<EvaluationOutcome> {
  const resolved = await resolveOptions(options);
  const outcome = await db.$transaction((tx) => evaluateDeviceInTx(tx, deviceId, resolved));
  if (outcome.createdTaskId && outcome.createdOnJobId) {
    await notifyChargeTaskSafely(outcome.createdTaskId);
  }
  return outcome;
}

async function notifyChargeTaskSafely(taskId: string): Promise<void> {
  try {
    const { notifyDeviceChargeTask } = await import("./notices");
    await notifyDeviceChargeTask(taskId);
  } catch (err) {
    logger.error({ err, taskId }, "property devices: charge task notice failed");
  }
}

export type ReadingInput = {
  deviceId: string;
  percent: number;
  source: ReadingSource;
  readAt: Date;
  recordedById: string | null;
  note?: string | null;
  /** Idempotency: the same id twice records one reading. */
  readingId?: string;
};

/**
 * Record a reading and move the device's latest reading forward (never
 * backwards: an older reading arriving late is kept in history only), then
 * evaluate the charge rule in the same transaction.
 */
export async function recordReading(input: ReadingInput, options: EvaluateOptions = {}): Promise<{ readingId: string; created: boolean; outcome: EvaluationOutcome }> {
  if (!isPercent(input.percent)) throw new Error("Battery must be a whole number from 0 to 100.");
  const resolved = await resolveOptions(options);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PropertyDevice" WHERE "id" = ${input.deviceId} FOR UPDATE`;
    const device = await tx.propertyDevice.findUnique({ where: { id: input.deviceId }, select: { id: true, lastReadingAt: true } });
    if (!device) throw new Error("NOT_FOUND");
    if (input.readingId) {
      const existing = await tx.propertyDeviceReading.findUnique({ where: { id: input.readingId }, select: { id: true, deviceId: true, percent: true } });
      if (existing) {
        if (existing.deviceId !== input.deviceId || existing.percent !== input.percent) throw new Error("This reading was already saved with different details. Reload before entering it again.");
        return { readingId: existing.id, created: false, outcome: await evaluateDeviceInTx(tx, input.deviceId, resolved) };
      }
    }
    const reading = await tx.propertyDeviceReading.create({
      data: {
        ...(input.readingId ? { id: input.readingId } : {}),
        deviceId: input.deviceId,
        percent: input.percent,
        source: input.source,
        readAt: input.readAt,
        recordedById: input.recordedById,
        note: input.note?.trim() || null,
      },
      select: { id: true },
    });
    if (!device.lastReadingAt || device.lastReadingAt.getTime() <= input.readAt.getTime()) {
      await tx.propertyDevice.update({
        where: { id: input.deviceId },
        data: { lastBatteryPercent: input.percent, lastReadingAt: input.readAt, lastReadingSource: input.source },
      });
    }
    return { readingId: reading.id, created: true, outcome: await evaluateDeviceInTx(tx, input.deviceId, resolved) };
  });
  if (result.outcome.createdTaskId && result.outcome.createdOnJobId) await notifyChargeTaskSafely(result.outcome.createdTaskId);
  return result;
}

/** The office closes an open condition with a note (e.g. "device replaced"). Cancels the open task. */
export async function closeConditionByOffice(deviceId: string, actorUserId: string, note: string, now: Date = new Date()): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("Add a note saying why the charge is no longer needed.");
  await db.$transaction(async (tx) => {
    const device = await lockDevice(tx, deviceId);
    if (!device) throw new Error("NOT_FOUND");
    if (device.chargeCondition === "NONE") return;
    await cancelOpenTask(tx, device.chargeTaskId, actorUserId, `Closed by the office: ${trimmed}`);
    await tx.propertyDevice.update({
      where: { id: deviceId },
      data: { chargeCondition: "NONE", chargeTaskId: null, conditionClosedAt: now, conditionClosedNote: trimmed, conditionClosedById: actorUserId },
    });
  });
}

/**
 * Keep every open charge task on the next available clean:
 * - a task waiting with no job is attached to the next upcoming job once one exists;
 * - a task on a job that is cancelled, finished without deciding it, or whose
 *   day has passed is moved to the next upcoming job, or back to waiting.
 * Called by the job cancel path for one job and by the scheduled check for all.
 * Returns the tasks that landed on a job (to notify).
 */
export async function rehomeChargeTasks(tx: Tx, input: { propertyId?: string; jobId?: string; timeZone: string; now: Date }): Promise<Array<{ taskId: string; jobId: string }>> {
  const tasks = await tx.jobTask.findMany({
    where: {
      executionStatus: "OPEN",
      metadata: { path: ["kind"], equals: DEVICE_CHARGE_TASK_KIND },
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
    },
    select: { id: true, propertyId: true, jobId: true, job: { select: { id: true, status: true, scheduledDate: true } } },
  });
  const today = new Date(`${formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd")}T00:00:00.000Z`);
  const landed: Array<{ taskId: string; jobId: string }> = [];
  for (const task of tasks) {
    const job = task.job;
    const stillUpcoming = job && !NOT_UPCOMING_STATUSES.includes(job.status as JobStatus) && job.scheduledDate.getTime() >= today.getTime();
    if (stillUpcoming) continue;
    // A submitted job decides its tasks in the submission; leave those alone.
    if (job && SUBMITTED_STATUSES.includes(job.status as JobStatus)) continue;
    const next = await nextUpcomingJob(tx, task.propertyId, input.timeZone, input.now);
    if (next?.id === task.jobId) continue;
    await tx.jobTask.update({
      where: { id: task.id },
      data: next
        ? { jobId: next.id, visibleToCleaner: true, approvalStatus: "APPROVED" }
        : { jobId: null, visibleToCleaner: false, approvalStatus: "AUTO_APPROVED" },
    });
    await tx.jobTaskEvent.create({
      data: {
        taskId: task.id,
        actorUserId: null,
        action: "DEVICE_CHARGE_TASK_MOVED",
        note: next ? "Moved to the next available clean." : "No upcoming clean: waiting until one is scheduled.",
      },
    });
    if (next) landed.push({ taskId: task.id, jobId: next.id });
  }
  return landed;
}

/** Notify for tasks that landed on a job; failures are logged, never thrown. */
export async function notifyLandedTasks(landed: Array<{ taskId: string }>): Promise<void> {
  for (const row of landed) await notifyChargeTaskSafely(row.taskId);
}
