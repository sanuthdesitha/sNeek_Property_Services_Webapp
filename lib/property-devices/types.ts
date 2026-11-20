/**
 * Property devices register (2026-11-20): named types and plain words shared by
 * the server, the API routes and the office screens. Plain module: no server
 * imports, so client components can use it.
 *
 * Honesty rules carried by these types:
 * - An unknown battery is `null`, shown as "Not known", never 0% or OK.
 * - A reading older than the stale age is STALE: it neither raises nor clears
 *   a low-battery condition.
 * - A wired device (batteryPowered false) never raises a charge task.
 */

export const DEVICE_PROVIDERS = ["RING", "MINUT", "MANUAL"] as const;
export type DeviceProvider = (typeof DEVICE_PROVIDERS)[number];

/** The two providers that have an organisation connection. */
export const CONNECTED_PROVIDERS = ["RING", "MINUT"] as const;
export type ConnectedProvider = (typeof CONNECTED_PROVIDERS)[number];

export const DEVICE_KINDS = ["CAMERA", "DOORBELL", "NOISE_SENSOR", "SMOKE_ALARM", "LOCK", "OTHER"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const READING_SOURCES = ["PROVIDER", "MANUAL", "CLEANER"] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

export type ChargeCondition = "NONE" | "NEEDS_CHARGE" | "CHARGED_AWAITING_CONFIRMATION";

/** What the office list shows for a device's battery. */
export type DeviceBatteryStatus = "OK" | "LOW" | "STALE" | "UNKNOWN" | "OFFLINE" | "WIRED" | "INACTIVE";

export const PROVIDER_LABEL: Record<DeviceProvider, string> = {
  RING: "Ring",
  MINUT: "Minut",
  MANUAL: "Added by hand",
};

export const KIND_LABEL: Record<DeviceKind, string> = {
  CAMERA: "Camera",
  DOORBELL: "Doorbell",
  NOISE_SENSOR: "Noise sensor",
  SMOKE_ALARM: "Smoke alarm",
  LOCK: "Smart lock",
  OTHER: "Other device",
};

export const SOURCE_LABEL: Record<ReadingSource, string> = {
  PROVIDER: "From the provider",
  MANUAL: "Entered by the office",
  CLEANER: "Seen by the cleaner",
};

export const STATUS_LABEL: Record<DeviceBatteryStatus, string> = {
  OK: "OK",
  LOW: "Low battery",
  STALE: "Reading out of date",
  UNKNOWN: "Not known",
  OFFLINE: "Offline",
  WIRED: "Wired (no battery)",
  INACTIVE: "Not in use",
};

export const CONDITION_LABEL: Record<ChargeCondition, string> = {
  NONE: "No charge needed",
  NEEDS_CHARGE: "Needs charging",
  CHARGED_AWAITING_CONFIRMATION: "Charged, awaiting a new reading",
};

/** Organisation settings (AppSetting `property_devices_v1:settings`). */
export type PropertyDeviceSettings = {
  /** Low battery at or below this percent raises a charge task. Default 25. */
  defaultThresholdPercent: number;
  /** Readings older than this are stale. Default 48 hours. */
  staleAfterHours: number;
  /** After a charge, wait this long before raising again for an unrecovered reading. Default 72 hours. */
  cooldownHours: number;
  /** How often a connected provider is polled. Default 6 hours. */
  pollIntervalHours: number;
  /** The office is told once after this many failed syncs in a row. Default 3. */
  failureNoticeAfter: number;
};

/** The reasons a cleaner can pick when they could not charge a device. */
export const COULD_NOT_CHARGE_REASONS = [
  "No charger or cable on site",
  "Device missing",
  "Could not reach the device",
  "Device damaged",
] as const;

/** JobTask metadata kind for a device charge task. */
export const DEVICE_CHARGE_TASK_KIND = "DEVICE_CHARGE";

export type DeviceChargeTaskMetadata = {
  kind: typeof DEVICE_CHARGE_TASK_KIND;
  /** Presented first and never folded on the cleaner's job ("Read first"). */
  priority: "HIGH";
  deviceId: string;
  deviceName: string;
  provider: DeviceProvider;
  readingPercent: number;
  /** A device charge is never "not applicable": done with a photo, or not done with a reason. */
  allowNotApplicable: false;
  /** A photo is required; "no photo, here is why" is not accepted for this task. */
  strictPhoto: true;
};

/** One device row as the office screens receive it. */
export type PropertyDeviceView = {
  id: string;
  propertyId: string;
  provider: DeviceProvider;
  externalDeviceId: string | null;
  name: string;
  kind: DeviceKind;
  locationNote: string | null;
  batteryPowered: boolean;
  lastBatteryPercent: number | null;
  lastReadingAt: string | null;
  lastReadingSource: ReadingSource | null;
  online: boolean | null;
  thresholdPercent: number | null;
  effectiveThresholdPercent: number;
  isActive: boolean;
  status: DeviceBatteryStatus;
  chargeCondition: ChargeCondition;
  conditionOpenedAt: string | null;
  chargedAt: string | null;
  lastCouldNotChargeAt: string | null;
  lastCouldNotChargeNote: string | null;
  /** The open charge task, if any, and the job it is on (null job: waiting for a clean). */
  chargeTask: { id: string; jobId: string | null; jobNumber: string | null; jobDay: string | null } | null;
  /** True when a charge is needed and no upcoming clean exists to carry the task. */
  noCleanScheduled: boolean;
};

export type DeviceReadingView = {
  id: string;
  percent: number;
  source: ReadingSource;
  readAt: string;
  recordedByName: string | null;
  note: string | null;
  jobId: string | null;
};

export type ConnectionStatusValue = "NOT_CONNECTED" | "CONNECTED" | "NEEDS_RECONNECT";

export type ProviderConnectionView = {
  provider: ConnectedProvider;
  status: ConnectionStatusValue;
  /** Missing configuration in words (Minut client id/secret, ENCRYPTION_KEY); empty when nothing is missing. */
  missing: string[];
  accountLabel: string | null;
  connectedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  failing: boolean;
};

export type ProviderLocationView = {
  id: string;
  provider: ConnectedProvider;
  externalLocationId: string;
  name: string;
  address: string | null;
  propertyId: string | null;
  propertyName: string | null;
  confirmedAt: string | null;
  /** Suggested property by name or address match; never linked until confirmed. */
  suggestion: { propertyId: string; propertyName: string } | null;
};

export type DeviceAttentionReason = "LOW" | "NO_CLEAN_SCHEDULED" | "COULD_NOT_CHARGE" | "OFFLINE" | "STALE" | "UNKNOWN" | "CONNECTION_BROKEN";

export const ATTENTION_LABEL: Record<DeviceAttentionReason, string> = {
  LOW: "Low battery",
  NO_CLEAN_SCHEDULED: "Needs charging, no clean scheduled",
  COULD_NOT_CHARGE: "Cleaner could not charge it",
  OFFLINE: "Offline",
  STALE: "Reading out of date",
  UNKNOWN: "Battery not known",
  CONNECTION_BROKEN: "Provider connection not working",
};

export type DeviceAttentionRow = {
  deviceId: string;
  propertyId: string;
  propertyName: string;
  deviceName: string;
  provider: DeviceProvider;
  lastBatteryPercent: number | null;
  lastReadingAt: string | null;
  reasons: DeviceAttentionReason[];
};

export function isConnectedProvider(value: string): value is ConnectedProvider {
  return (CONNECTED_PROVIDERS as readonly string[]).includes(value);
}

/** "18%" or "Not known" — never 0% for an unknown battery. */
export function batteryText(percent: number | null | undefined): string {
  return typeof percent === "number" && Number.isFinite(percent) ? `${percent}%` : "Not known";
}
