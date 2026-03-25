import { LaundryFlag, LaundryStatus } from "@prisma/client";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getAppSettings } from "@/lib/settings";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { getAssignedLaundryUsersForProperty } from "@/lib/laundry/teams";
import { resolveAppUrl } from "@/lib/app-url";
import { readSettingStore, writeSettingStore } from "@/lib/phase4/store";
import type { LaundryPlanDraftItem } from "@/lib/laundry/planner";

const LAUNDRY_SYNC_DRAFT_KEY = "laundry_sync_reschedule_draft_v1";

export type LaundrySyncDraftOperation = "CREATE" | "UPDATE";

export type LaundrySyncDraftItem = LaundryPlanDraftItem & {
  operation: LaundrySyncDraftOperation;
  taskId: string | null;
  currentPickupDate: string | null;
  currentDropoffDate: string | null;
  currentStatus: LaundryStatus | null;
  currentFlagReason: LaundryFlag | null;
  currentFlagNotes: string | null;
  generatedAt: string;
  sourcePropertyId: string;
};

type LaundrySyncDraftStore = {
  updatedAt: string | null;
  items: LaundrySyncDraftItem[];
};

const DEFAULT_STORE: LaundrySyncDraftStore = {
  updatedAt: null,
  items: [],
};

function sanitizeNullableDate(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeLaundryStatus(value: unknown): LaundryStatus | null {
  if (typeof value !== "string") return null;
  return Object.values(LaundryStatus).includes(value as LaundryStatus) ? (value as LaundryStatus) : null;
}

function sanitizeLaundryFlag(value: unknown): LaundryFlag | null {
  if (typeof value !== "string") return null;
  return Object.values(LaundryFlag).includes(value as LaundryFlag) ? (value as LaundryFlag) : null;
}

function sanitizeDraftItem(value: unknown): LaundrySyncDraftItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.jobId !== "string" || !row.jobId.trim()) return null;
  if (typeof row.propertyId !== "string" || !row.propertyId.trim()) return null;
  if (typeof row.propertyName !== "string" || !row.propertyName.trim()) return null;

  const cleanDate = sanitizeNullableDate(row.cleanDate);
  const pickupDate = sanitizeNullableDate(row.pickupDate);
  const dropoffDate = sanitizeNullableDate(row.dropoffDate);
  const status = sanitizeLaundryStatus(row.status);
  const operation =
    row.operation === "UPDATE"
      ? "UPDATE"
      : row.operation === "CREATE"
        ? "CREATE"
        : null;

  if (!cleanDate || !pickupDate || !dropoffDate || !status || !operation) return null;

  return {
    jobId: row.jobId.trim(),
    propertyId: row.propertyId.trim(),
    propertyName: row.propertyName.trim(),
    suburb: typeof row.suburb === "string" ? row.suburb.trim() : "",
    cleanDate,
    pickupDate,
    dropoffDate,
    status,
    flagReason: sanitizeLaundryFlag(row.flagReason),
    flagNotes: typeof row.flagNotes === "string" && row.flagNotes.trim() ? row.flagNotes.trim() : null,
    scenario:
      row.scenario === "BACK_TO_BACK" ||
      row.scenario === "MICRO_CYCLE" ||
      row.scenario === "COMPRESSED" ||
      row.scenario === "FALLBACK"
        ? row.scenario
        : "FALLBACK",
    linenBufferSets: Number.isFinite(Number(row.linenBufferSets)) ? Math.max(0, Math.trunc(Number(row.linenBufferSets))) : 0,
    operation,
    taskId: typeof row.taskId === "string" && row.taskId.trim() ? row.taskId.trim() : null,
    currentPickupDate: sanitizeNullableDate(row.currentPickupDate),
    currentDropoffDate: sanitizeNullableDate(row.currentDropoffDate),
    currentStatus: sanitizeLaundryStatus(row.currentStatus),
    currentFlagReason: sanitizeLaundryFlag(row.currentFlagReason),
    currentFlagNotes:
      typeof row.currentFlagNotes === "string" && row.currentFlagNotes.trim() ? row.currentFlagNotes.trim() : null,
    generatedAt: sanitizeNullableDate(row.generatedAt) ?? new Date().toISOString(),
    sourcePropertyId:
      typeof row.sourcePropertyId === "string" && row.sourcePropertyId.trim() ? row.sourcePropertyId.trim() : row.propertyId.trim(),
  };
}

function sanitizeStore(input: unknown, fallback: LaundrySyncDraftStore): LaundrySyncDraftStore {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const row = input as Record<string, unknown>;
  const items = Array.isArray(row.items)
    ? row.items.map(sanitizeDraftItem).filter((item): item is LaundrySyncDraftItem => Boolean(item))
    : fallback.items;
  return {
    updatedAt: sanitizeNullableDate(row.updatedAt),
    items: items.sort((a, b) => {
      const pickupOrder = new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime();
      if (pickupOrder !== 0) return pickupOrder;
      const suburbOrder = a.suburb.localeCompare(b.suburb);
      if (suburbOrder !== 0) return suburbOrder;
      return a.propertyName.localeCompare(b.propertyName);
    }),
  };
}

async function readStore() {
  const payload = await readSettingStore<LaundrySyncDraftStore>(
    LAUNDRY_SYNC_DRAFT_KEY,
    DEFAULT_STORE,
    sanitizeStore
  );
  return payload.data;
}

async function writeStore(value: LaundrySyncDraftStore) {
  return writeSettingStore(LAUNDRY_SYNC_DRAFT_KEY, { version: 1, data: value });
}

export async function getPendingLaundrySyncDraft() {
  return readStore();
}

export async function replacePendingLaundrySyncDraftForProperty(params: {
  propertyId: string;
  items: LaundrySyncDraftItem[];
}) {
  const current = await readStore();
  const remaining = current.items.filter((item) => item.sourcePropertyId !== params.propertyId);
  const nextItems = [...remaining, ...params.items];
  const nextStore: LaundrySyncDraftStore = {
    updatedAt: nextItems.length > 0 ? new Date().toISOString() : null,
    items: nextItems,
  };
  await writeStore(nextStore);
  return nextStore;
}

export async function clearPendingLaundrySyncDraft() {
  await writeStore(DEFAULT_STORE);
}

export function summarizePendingLaundrySyncDraft(store: LaundrySyncDraftStore) {
  const propertyIds = new Set(store.items.map((item) => item.propertyId));
  const createCount = store.items.filter((item) => item.operation === "CREATE").length;
  const updateCount = store.items.filter((item) => item.operation === "UPDATE").length;
  return {
    updatedAt: store.updatedAt,
    itemCount: store.items.length,
    propertyCount: propertyIds.size,
    createCount,
    updateCount,
    items: store.items,
  };
}

export async function notifyLaundryTeamsForApprovedSyncDraft(items: LaundrySyncDraftItem[]) {
  if (items.length === 0) return;

  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const laundryPortalUrl = resolveAppUrl("/laundry");
  const grouped = new Map<
    string,
    { propertyId: string; propertyName: string; items: LaundrySyncDraftItem[] }
  >();

  for (const item of items) {
    const existing = grouped.get(item.propertyId);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.set(item.propertyId, {
        propertyId: item.propertyId,
        propertyName: item.propertyName,
        items: [item],
      });
    }
  }

  for (const group of Array.from(grouped.values())) {
    const recipients = await getAssignedLaundryUsersForProperty(group.propertyId);
    if (recipients.length === 0) continue;

    const orderedItems = [...group.items].sort(
      (a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime()
    );
    const webSubject = `Laundry schedule updated - ${group.propertyName}`;
    const webBody = `${orderedItems.length} laundry booking${
      orderedItems.length === 1 ? "" : "s"
    } updated after reservation sync. Review the laundry portal.`;
    const htmlRows = orderedItems
      .map((item) => {
        const pickupLabel = format(toZonedTime(new Date(item.pickupDate), timezone), "EEE dd MMM");
        const dropoffLabel = format(toZonedTime(new Date(item.dropoffDate), timezone), "EEE dd MMM");
        const cleanLabel = format(toZonedTime(new Date(item.cleanDate), timezone), "EEE dd MMM");
        return `<li><strong>${item.operation === "CREATE" ? "New" : "Updated"}</strong> booking for clean ${cleanLabel}: pickup ${pickupLabel}, drop-off ${dropoffLabel}.</li>`;
      })
      .join("");

    await deliverNotificationToRecipients({
      recipients,
      category: "laundry",
      web: {
        subject: webSubject,
        body: webBody,
      },
      email: {
        subject: webSubject,
        html: `
          <h2 style="margin:0 0 12px;">Laundry schedule updated</h2>
          <p style="margin:0 0 12px;">Admin approved reservation-driven schedule changes for <strong>${group.propertyName}</strong>.</p>
          <ul style="margin:0 0 16px 18px; padding:0;">${htmlRows}</ul>
          <p style="margin:0 0 16px;">Open the laundry portal to review the latest pickup and drop-off dates.</p>
          <p style="margin:0;"><a href="${laundryPortalUrl}">Open laundry portal</a></p>
        `,
        logBody: webBody,
      },
      sms: `${group.propertyName}: ${orderedItems.length} laundry booking${
        orderedItems.length === 1 ? "" : "s"
      } updated after sync. Check the laundry portal.`,
    });
  }
}
