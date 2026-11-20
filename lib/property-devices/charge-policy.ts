/**
 * The low-battery rule (2026-11-20), as pure functions so every caller — the
 * scheduled check, a manual reading, a provider sync, a cleaner's reading —
 * decides the same way and the boundaries are tested in one place.
 *
 * - Threshold: the device's own override, else the property's, else the
 *   organisation default (25%). At or below the threshold is low: 25 raises at
 *   25%, 26% does not.
 * - Only a non-stale reading counts. An unknown (null) or stale reading never
 *   raises a charge and never clears an open condition.
 * - A wired or inactive device never raises.
 * - A condition closes only on a later PROVIDER or MANUAL reading above the
 *   threshold (or the office closing it with a note, which is not decided
 *   here). A cleaner's reading is kept as evidence but does not close it.
 * - After a completed charge the condition waits ("charged, awaiting a new
 *   reading"). It is raised again only when a reading newer than the charge is
 *   still low AND the cool-down has passed.
 */
import type { ChargeCondition, DeviceBatteryStatus, PropertyDeviceSettings, ReadingSource } from "./types";

export const DEFAULT_DEVICE_SETTINGS: PropertyDeviceSettings = {
  defaultThresholdPercent: 25,
  staleAfterHours: 48,
  cooldownHours: 72,
  pollIntervalHours: 6,
  failureNoticeAfter: 3,
};

const HOUR_MS = 60 * 60 * 1000;

export type ThresholdSources = {
  deviceThreshold: number | null;
  propertyThreshold: number | null;
  organisationThreshold: number;
};

/** The device override wins, then the property's, then the organisation default. */
export function effectiveThreshold(sources: ThresholdSources): number {
  if (isPercent(sources.deviceThreshold)) return sources.deviceThreshold;
  if (isPercent(sources.propertyThreshold)) return sources.propertyThreshold;
  return sources.organisationThreshold;
}

export function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

export type ReadingFacts = {
  percent: number | null;
  readAt: Date | null;
  source: ReadingSource | null;
};

/** A reading exists, has a time, and is younger than the stale age. */
export function isFreshReading(reading: ReadingFacts, now: Date, staleAfterHours: number): boolean {
  if (!isPercent(reading.percent) || !reading.readAt) return false;
  return now.getTime() - reading.readAt.getTime() <= staleAfterHours * HOUR_MS;
}

export type DeviceStatusInput = {
  isActive: boolean;
  batteryPowered: boolean;
  online: boolean | null;
  reading: ReadingFacts;
  thresholdPercent: number;
};

/** What the office list shows. Offline and stale win over a number that may be old. */
export function deviceBatteryStatus(device: DeviceStatusInput, now: Date, staleAfterHours: number): DeviceBatteryStatus {
  if (!device.isActive) return "INACTIVE";
  if (!device.batteryPowered) return "WIRED";
  if (device.online === false) return "OFFLINE";
  if (!isPercent(device.reading.percent) || !device.reading.readAt) return "UNKNOWN";
  if (!isFreshReading(device.reading, now, staleAfterHours)) return "STALE";
  return device.reading.percent <= device.thresholdPercent ? "LOW" : "OK";
}

export type ChargeDecisionInput = DeviceStatusInput & {
  condition: ChargeCondition;
  conditionOpenedAt: Date | null;
  chargedAt: Date | null;
  /** True when a charge task for this device is open (on a job or waiting for one). */
  hasOpenTask: boolean;
};

export type ChargeDecision =
  /** Open a condition (if none) and create one charge task. */
  | { action: "RAISE"; reason: string }
  /** The condition is open but its task is gone (cancelled elsewhere): create the task again. */
  | { action: "ENSURE_TASK"; reason: string }
  /** A later provider or office reading is above the threshold: close the condition. */
  | { action: "CLOSE_RECOVERED"; reason: string }
  | { action: "NONE"; reason: string };

/** Readings that may close a condition: the provider's, or one the office entered. */
export function readingMayClose(source: ReadingSource | null): boolean {
  return source === "PROVIDER" || source === "MANUAL";
}

export function decideCharge(input: ChargeDecisionInput, now: Date, settings: Pick<PropertyDeviceSettings, "staleAfterHours" | "cooldownHours">): ChargeDecision {
  if (!input.isActive) return { action: "NONE", reason: "Device is not in use." };
  if (!input.batteryPowered) return { action: "NONE", reason: "Wired devices never need charging." };
  if (!isFreshReading(input.reading, now, settings.staleAfterHours)) {
    return { action: "NONE", reason: input.reading.readAt ? "The reading is out of date; it neither raises nor clears." : "The battery level is not known." };
  }
  const percent = input.reading.percent as number;
  const readAt = input.reading.readAt as Date;
  const low = percent <= input.thresholdPercent;

  if (!low) {
    if (input.condition === "NONE") return { action: "NONE", reason: "Battery above the threshold." };
    const openedAt = input.conditionOpenedAt ?? new Date(0);
    if (!readingMayClose(input.reading.source)) return { action: "NONE", reason: "A cleaner's reading is kept as evidence; a provider or office reading confirms the charge." };
    if (readAt.getTime() <= openedAt.getTime()) return { action: "NONE", reason: "The reading is not newer than the low reading." };
    return { action: "CLOSE_RECOVERED", reason: `Battery back to ${percent}%, above the ${input.thresholdPercent}% threshold.` };
  }

  if (input.condition === "NONE") return { action: "RAISE", reason: `Battery at ${percent}%, at or below the ${input.thresholdPercent}% threshold.` };
  if (input.condition === "NEEDS_CHARGE") {
    return input.hasOpenTask
      ? { action: "NONE", reason: "A charge task is already open." }
      : { action: "ENSURE_TASK", reason: "The condition is open but has no charge task." };
  }
  // CHARGED_AWAITING_CONFIRMATION
  const chargedAt = input.chargedAt ?? input.conditionOpenedAt ?? new Date(0);
  if (readAt.getTime() <= chargedAt.getTime()) return { action: "NONE", reason: "No reading since the charge yet." };
  if (now.getTime() - chargedAt.getTime() < settings.cooldownHours * HOUR_MS) {
    return { action: "NONE", reason: "Within the cool-down after the last charge." };
  }
  return { action: "RAISE", reason: `Still at ${percent}% after the charge and the cool-down has passed.` };
}

/** The task title the cleaner sees, e.g. "Charge the Ring camera: Front door (18%)". */
export function chargeTaskTitle(input: { providerLabel: string | null; kindLabel: string; deviceName: string; percent: number }): string {
  const what = `${input.providerLabel ? `${input.providerLabel} ` : ""}${input.kindLabel.toLowerCase()}`;
  return `Charge the ${what}: ${input.deviceName} (${input.percent}%)`.slice(0, 300);
}
