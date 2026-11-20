import "server-only";
/**
 * The cleaner's answer on a device charge task (2026-11-20), called by the
 * JobTask service inside the job submission's transaction, after the existing
 * carry-forward has run.
 *
 * - Completed: only with a photo (the submit route and the JobTask service both
 *   refuse a missing photo for this task kind). The device becomes "charged,
 *   awaiting a new reading". A battery percent the cleaner saw is kept as a
 *   CLEANER reading (evidence; it does not close the condition).
 * - Not completed ("could not do", reason required): the existing
 *   carry-forward has already created the task for the next clean; the device
 *   now points at that task, and keeps the reason for the office list.
 *
 * Kept free of the JobTask service import so that service can call it.
 */
import type { Prisma } from "@prisma/client";
import { isPercent } from "./charge-policy";
import { DEVICE_CHARGE_TASK_KIND, type DeviceChargeTaskMetadata } from "./types";

type Tx = Prisma.TransactionClient;

export type DeviceChargeDecision = {
  taskId: string;
  jobId: string;
  decision: "COMPLETED" | "NOT_COMPLETED" | "NOT_APPLICABLE";
  cleanerId: string;
  note: string | null;
  proofKeys: string[];
  observedBatteryPercent: number | null;
};

export function isDeviceChargeTaskMetadata(metadata: unknown): metadata is DeviceChargeTaskMetadata {
  return Boolean(metadata) && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as { kind?: unknown }).kind === DEVICE_CHARGE_TASK_KIND && typeof (metadata as { deviceId?: unknown }).deviceId === "string";
}

/** The metadata a carried-forward device charge task keeps, so the next clean presents and enforces it the same way. */
export function carriedDeviceChargeMetadata(metadata: unknown): DeviceChargeTaskMetadata | null {
  return isDeviceChargeTaskMetadata(metadata) ? { ...metadata, allowNotApplicable: false, strictPhoto: true, priority: "HIGH" } : null;
}

export async function applyDeviceChargeTaskDecision(tx: Tx, metadata: DeviceChargeTaskMetadata, input: DeviceChargeDecision): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "PropertyDevice" WHERE "id" = ${metadata.deviceId} FOR UPDATE`;
  const device = await tx.propertyDevice.findUnique({ where: { id: metadata.deviceId }, select: { id: true, chargeTaskId: true, chargeCondition: true } });
  if (!device) return;
  const now = new Date();

  if (input.decision === "COMPLETED") {
    await tx.propertyDevice.update({
      where: { id: device.id },
      data: {
        chargeCondition: device.chargeCondition === "NONE" ? "NONE" : "CHARGED_AWAITING_CONFIRMATION",
        chargedAt: now,
        chargedTaskId: input.taskId,
        chargeTaskId: device.chargeTaskId === input.taskId ? null : device.chargeTaskId,
      },
    });
    if (isPercent(input.observedBatteryPercent)) {
      await tx.propertyDeviceReading.create({
        data: {
          deviceId: device.id,
          percent: input.observedBatteryPercent,
          source: "CLEANER",
          readAt: now,
          recordedById: input.cleanerId,
          jobId: input.jobId,
          jobTaskId: input.taskId,
          note: "Seen by the cleaner after charging.",
        },
      });
      await tx.propertyDevice.update({
        where: { id: device.id },
        data: { lastBatteryPercent: input.observedBatteryPercent, lastReadingAt: now, lastReadingSource: "CLEANER" },
      });
    }
    return;
  }

  // Not completed: the existing carry-forward created the next task as a child of this one.
  const carried = await tx.jobTask.findFirst({
    where: { parentTaskId: input.taskId, source: "CARRY_FORWARD", executionStatus: "OPEN" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  await tx.propertyDevice.update({
    where: { id: device.id },
    data: {
      chargeTaskId: carried?.id ?? null,
      lastCouldNotChargeAt: now,
      lastCouldNotChargeNote: input.note ?? "No reason given.",
    },
  });
}
