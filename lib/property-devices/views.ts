import "server-only";
/**
 * Read models for the office screens (2026-11-20): a property's devices, one
 * device's readings, the attention list across properties and its count, and
 * the provider locations with a suggested property (never linked until the
 * office confirms).
 */
import { db } from "@/lib/db";
import { connectionViews } from "./connections";
import { deviceBatteryStatus, effectiveThreshold } from "./charge-policy";
import { readPropertyDeviceSettings } from "./settings";
import type { DeviceAttentionReason, DeviceAttentionRow, DeviceReadingView, PropertyDeviceSettings, PropertyDeviceView, ProviderLocationView } from "./types";

const DEVICE_SELECT = {
  id: true, propertyId: true, provider: true, externalDeviceId: true, name: true, kind: true, locationNote: true, batteryPowered: true,
  lastBatteryPercent: true, lastReadingAt: true, lastReadingSource: true, online: true, thresholdPercent: true, isActive: true,
  chargeCondition: true, conditionOpenedAt: true, chargeTaskId: true, chargedAt: true, lastCouldNotChargeAt: true, lastCouldNotChargeNote: true, updatedAt: true,
  property: { select: { name: true, deviceBatteryThresholdPercent: true } },
} as const;

type DeviceRow = Awaited<ReturnType<typeof loadDeviceRows>>[number];

function loadDeviceRows(where: { propertyId?: string; isActive?: boolean; id?: string }) {
  return db.propertyDevice.findMany({ where, select: DEVICE_SELECT, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
}

async function chargeTasks(taskIds: string[]) {
  if (!taskIds.length) return new Map<string, { id: string; jobId: string | null; executionStatus: string; job: { jobNumber: string | null; scheduledDate: Date } | null }>();
  const rows = await db.jobTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, jobId: true, executionStatus: true, job: { select: { jobNumber: true, scheduledDate: true } } } });
  return new Map(rows.map((row) => [row.id, row]));
}

function toView(row: DeviceRow, settings: PropertyDeviceSettings, now: Date, task: { id: string; jobId: string | null; executionStatus: string; job: { jobNumber: string | null; scheduledDate: Date } | null } | undefined): PropertyDeviceView {
  const threshold = effectiveThreshold({ deviceThreshold: row.thresholdPercent, propertyThreshold: row.property.deviceBatteryThresholdPercent, organisationThreshold: settings.defaultThresholdPercent });
  const openTask = task && task.executionStatus === "OPEN" ? task : null;
  return {
    id: row.id,
    propertyId: row.propertyId,
    provider: row.provider,
    externalDeviceId: row.externalDeviceId,
    name: row.name,
    kind: row.kind,
    locationNote: row.locationNote,
    batteryPowered: row.batteryPowered,
    lastBatteryPercent: row.lastBatteryPercent,
    lastReadingAt: row.lastReadingAt?.toISOString() ?? null,
    lastReadingSource: row.lastReadingSource,
    online: row.online,
    thresholdPercent: row.thresholdPercent,
    effectiveThresholdPercent: threshold,
    isActive: row.isActive,
    status: deviceBatteryStatus({ isActive: row.isActive, batteryPowered: row.batteryPowered, online: row.online, reading: { percent: row.lastBatteryPercent, readAt: row.lastReadingAt, source: row.lastReadingSource }, thresholdPercent: threshold }, now, settings.staleAfterHours),
    chargeCondition: row.chargeCondition,
    conditionOpenedAt: row.conditionOpenedAt?.toISOString() ?? null,
    chargedAt: row.chargedAt?.toISOString() ?? null,
    lastCouldNotChargeAt: row.lastCouldNotChargeAt?.toISOString() ?? null,
    lastCouldNotChargeNote: row.lastCouldNotChargeNote,
    chargeTask: openTask ? { id: openTask.id, jobId: openTask.jobId, jobNumber: openTask.job?.jobNumber ?? null, jobDay: openTask.job ? openTask.job.scheduledDate.toISOString().slice(0, 10) : null } : null,
    noCleanScheduled: row.chargeCondition === "NEEDS_CHARGE" && (!openTask || !openTask.jobId),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPropertyDevices(propertyId: string, now: Date = new Date()): Promise<{ devices: PropertyDeviceView[]; propertyThresholdPercent: number | null; organisationThresholdPercent: number; staleAfterHours: number }> {
  const [settings, property, rows] = await Promise.all([
    readPropertyDeviceSettings(),
    db.property.findUnique({ where: { id: propertyId }, select: { id: true, deviceBatteryThresholdPercent: true } }),
    loadDeviceRows({ propertyId }),
  ]);
  if (!property) throw new Error("NOT_FOUND");
  const tasks = await chargeTasks(rows.flatMap((row) => (row.chargeTaskId ? [row.chargeTaskId] : [])));
  return {
    devices: rows.map((row) => toView(row, settings, now, row.chargeTaskId ? tasks.get(row.chargeTaskId) : undefined)),
    propertyThresholdPercent: property.deviceBatteryThresholdPercent,
    organisationThresholdPercent: settings.defaultThresholdPercent,
    staleAfterHours: settings.staleAfterHours,
  };
}

export async function listDeviceReadings(deviceId: string, take = 30): Promise<DeviceReadingView[]> {
  const rows = await db.propertyDeviceReading.findMany({ where: { deviceId }, orderBy: { readAt: "desc" }, take });
  const userIds = Array.from(new Set(rows.flatMap((row) => (row.recordedById ? [row.recordedById] : []))));
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name?.trim() || user.email]));
  return rows.map((row) => ({
    id: row.id,
    percent: row.percent,
    source: row.source,
    readAt: row.readAt.toISOString(),
    recordedByName: row.recordedById ? names.get(row.recordedById) ?? null : null,
    note: row.note,
    jobId: row.jobId,
  }));
}

function attentionReasons(view: PropertyDeviceView, connectionBroken: boolean): DeviceAttentionReason[] {
  if (!view.isActive || !view.batteryPowered) return [];
  const reasons: DeviceAttentionReason[] = [];
  if (view.chargeCondition === "NEEDS_CHARGE" || view.status === "LOW") reasons.push("LOW");
  if (view.noCleanScheduled) reasons.push("NO_CLEAN_SCHEDULED");
  if (view.chargeCondition === "NEEDS_CHARGE" && view.lastCouldNotChargeAt) reasons.push("COULD_NOT_CHARGE");
  if (view.status === "OFFLINE") reasons.push("OFFLINE");
  if (view.status === "STALE") reasons.push("STALE");
  if (view.status === "UNKNOWN") reasons.push("UNKNOWN");
  if (connectionBroken) reasons.push("CONNECTION_BROKEN");
  return reasons;
}

/** Devices needing attention across properties, worst first. */
export async function listDeviceAttention(now: Date = new Date()): Promise<{ rows: DeviceAttentionRow[]; brokenProviders: string[] }> {
  const settings = await readPropertyDeviceSettings();
  const [rows, connections] = await Promise.all([loadDeviceRows({ isActive: true }), connectionViews(settings)]);
  const broken = new Set(connections.filter((connection) => connection.failing).map((connection) => connection.provider as string));
  const tasks = await chargeTasks(rows.flatMap((row) => (row.chargeTaskId ? [row.chargeTaskId] : [])));
  const order: DeviceAttentionReason[] = ["NO_CLEAN_SCHEDULED", "COULD_NOT_CHARGE", "LOW", "CONNECTION_BROKEN", "OFFLINE", "STALE", "UNKNOWN"];
  const result = rows.flatMap((row) => {
    const view = toView(row, settings, now, row.chargeTaskId ? tasks.get(row.chargeTaskId) : undefined);
    const reasons = attentionReasons(view, broken.has(row.provider));
    if (!reasons.length) return [];
    return [{ deviceId: row.id, propertyId: row.propertyId, propertyName: row.property.name, deviceName: row.name, provider: row.provider, lastBatteryPercent: row.lastBatteryPercent, lastReadingAt: view.lastReadingAt, reasons }];
  });
  result.sort((a, b) => Math.min(...a.reasons.map((r) => order.indexOf(r))) - Math.min(...b.reasons.map((r) => order.indexOf(r))) || a.propertyName.localeCompare(b.propertyName));
  return { rows: result, brokenProviders: Array.from(broken) };
}

function normalise(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2);
}

/** A suggested property for a provider location: the best word overlap of name and address. Never linked automatically. */
export function suggestProperty(location: { name: string; address: string | null }, properties: Array<{ id: string; name: string; address: string | null; suburb: string | null }>): { propertyId: string; propertyName: string } | null {
  const words = new Set(normalise(`${location.name} ${location.address ?? ""}`));
  if (!words.size) return null;
  let best: { propertyId: string; propertyName: string; score: number } | null = null;
  for (const property of properties) {
    const candidate = normalise(`${property.name} ${property.address ?? ""} ${property.suburb ?? ""}`);
    const score = candidate.filter((word) => words.has(word)).length;
    if (score >= 2 && (!best || score > best.score)) best = { propertyId: property.id, propertyName: property.name, score };
  }
  return best ? { propertyId: best.propertyId, propertyName: best.propertyName } : null;
}

export async function listProviderLocations(): Promise<ProviderLocationView[]> {
  const [locations, properties] = await Promise.all([
    db.deviceProviderLocation.findMany({ orderBy: [{ provider: "asc" }, { name: "asc" }] }),
    db.property.findMany({ where: { isActive: true }, select: { id: true, name: true, address: true, suburb: true } }),
  ]);
  const names = new Map(properties.map((property) => [property.id, property.name]));
  return locations.map((location) => ({
    id: location.id,
    provider: location.provider as "RING" | "MINUT",
    externalLocationId: location.externalLocationId,
    name: location.name,
    address: location.address,
    propertyId: location.propertyId,
    propertyName: location.propertyId ? names.get(location.propertyId) ?? null : null,
    confirmedAt: location.confirmedAt?.toISOString() ?? null,
    suggestion: location.propertyId ? null : suggestProperty(location, properties),
  }));
}

