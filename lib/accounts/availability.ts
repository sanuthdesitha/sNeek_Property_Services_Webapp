import { db } from "@/lib/db";

const CLEANER_AVAILABILITY_KEY = "cleaner_availability_v1";

export type AvailabilityMode = "FIXED" | "FLEXIBLE";

export interface AvailabilitySlot {
  start: string;
  end: string;
}

export interface CleanerAvailabilityProfile {
  userId: string;
  mode: AvailabilityMode;
  weekly: Record<string, AvailabilitySlot[]>;
  dateOverrides: Record<string, AvailabilitySlot[]>;
  notes: string | null;
  updatedAt: string;
}

interface StoreData {
  profiles: CleanerAvailabilityProfile[];
}

const DEFAULT_STORE: StoreData = { profiles: [] };

function sanitizeText(value: unknown, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function sanitizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\d{2}:\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function sanitizeSlot(value: unknown): AvailabilitySlot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const start = sanitizeTime(row.start);
  const end = sanitizeTime(row.end);
  if (!start || !end || start >= end) return null;
  return { start, end };
}

function sanitizeSlots(value: unknown): AvailabilitySlot[] {
  if (!Array.isArray(value)) return [];
  const rows = value.map(sanitizeSlot).filter((item): item is AvailabilitySlot => Boolean(item));
  return rows
    .sort((a, b) => `${a.start}-${a.end}`.localeCompare(`${b.start}-${b.end}`))
    .slice(0, 12);
}

function sanitizeWeekly(value: unknown): Record<string, AvailabilitySlot[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const out: Record<string, AvailabilitySlot[]> = {};
  for (let i = 0; i <= 6; i += 1) {
    const key = String(i);
    const slots = sanitizeSlots(row[key]);
    if (slots.length > 0) out[key] = slots;
  }
  return out;
}

function sanitizeDateOverrides(value: unknown): Record<string, AvailabilitySlot[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const out: Record<string, AvailabilitySlot[]> = {};
  for (const [date, slotsRaw] of Object.entries(row)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const slots = sanitizeSlots(slotsRaw);
    if (slots.length > 0) out[date] = slots;
  }
  return out;
}

function sanitizeProfile(value: unknown): CleanerAvailabilityProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const userId = sanitizeText(row.userId, 100);
  if (!userId) return null;
  const mode: AvailabilityMode = row.mode === "FLEXIBLE" ? "FLEXIBLE" : "FIXED";
  return {
    userId,
    mode,
    weekly: sanitizeWeekly(row.weekly),
    dateOverrides: sanitizeDateOverrides(row.dateOverrides),
    notes: sanitizeText(row.notes, 1000) || null,
    updatedAt: sanitizeText(row.updatedAt, 40) || new Date().toISOString(),
  };
}

function sanitizeStore(value: unknown): StoreData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_STORE;
  const row = value as Record<string, unknown>;
  const profiles = Array.isArray(row.profiles)
    ? row.profiles.map(sanitizeProfile).filter((item): item is CleanerAvailabilityProfile => Boolean(item))
    : [];
  return { profiles };
}

async function readStore() {
  const row = await db.appSetting.findUnique({ where: { key: CLEANER_AVAILABILITY_KEY } });
  return sanitizeStore(row?.value);
}

async function writeStore(data: StoreData) {
  await db.appSetting.upsert({
    where: { key: CLEANER_AVAILABILITY_KEY },
    create: { key: CLEANER_AVAILABILITY_KEY, value: data as any },
    update: { value: data as any },
  });
}

export function defaultAvailabilityProfile(userId: string): CleanerAvailabilityProfile {
  return {
    userId,
    mode: "FIXED",
    weekly: {},
    dateOverrides: {},
    notes: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getCleanerAvailability(userId: string) {
  const store = await readStore();
  return store.profiles.find((item) => item.userId === userId) ?? defaultAvailabilityProfile(userId);
}

export async function listCleanerAvailabilities(userIds?: string[]) {
  const store = await readStore();
  if (!userIds || userIds.length === 0) return store.profiles;
  const set = new Set(userIds);
  return store.profiles.filter((item) => set.has(item.userId));
}

export async function saveCleanerAvailability(
  userId: string,
  patch: Partial<Omit<CleanerAvailabilityProfile, "userId" | "updatedAt">>
) {
  const store = await readStore();
  const index = store.profiles.findIndex((item) => item.userId === userId);
  const current = index >= 0 ? store.profiles[index] : defaultAvailabilityProfile(userId);
  const next: CleanerAvailabilityProfile = {
    userId,
    mode: patch.mode === "FLEXIBLE" ? "FLEXIBLE" : patch.mode === "FIXED" ? "FIXED" : current.mode,
    weekly: patch.weekly !== undefined ? sanitizeWeekly(patch.weekly) : current.weekly,
    dateOverrides:
      patch.dateOverrides !== undefined ? sanitizeDateOverrides(patch.dateOverrides) : current.dateOverrides,
    notes: patch.notes !== undefined ? sanitizeText(patch.notes, 1000) || null : current.notes,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) {
    store.profiles[index] = next;
  } else {
    store.profiles.push(next);
  }
  if (store.profiles.length > 3000) {
    store.profiles = store.profiles.slice(-3000);
  }
  await writeStore(store);
  return next;
}

