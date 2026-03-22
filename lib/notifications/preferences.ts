import { NotificationChannel, Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationChannelPreference,
  type NotificationPreferenceMap,
  getAppSettings,
} from "@/lib/settings";

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)) as NotificationPreferenceMap;
}

function sanitizePreferenceMap(input: unknown): NotificationPreferenceMap {
  const fallback = cloneDefaults();
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const row = input as Record<string, unknown>;
  const next = cloneDefaults();
  for (const category of NOTIFICATION_CATEGORIES) {
    const categoryRow = row[category];
    if (!categoryRow || typeof categoryRow !== "object" || Array.isArray(categoryRow)) continue;
    const pref = categoryRow as Record<string, unknown>;
    next[category] = {
      web: typeof pref.web === "boolean" ? pref.web : fallback[category].web,
      email: typeof pref.email === "boolean" ? pref.email : fallback[category].email,
      sms: typeof pref.sms === "boolean" ? pref.sms : fallback[category].sms,
    };
  }
  return next;
}

function channelToKey(channel: NotificationChannel | "WEB"): keyof NotificationChannelPreference {
  if (channel === "WEB") return "web";
  if (channel === NotificationChannel.EMAIL) return "email";
  return "sms";
}

export async function getNotificationDefaultPreferences() {
  const settings = await getAppSettings();
  return sanitizePreferenceMap(settings.notificationDefaults.categories);
}

export async function getUserNotificationPreferences(userId: string) {
  const [defaults, row] = await Promise.all([
    getNotificationDefaultPreferences(),
    db.userNotificationPreference.findUnique({
      where: { userId },
      select: { categories: true },
    }),
  ]);

  if (!row) {
    return defaults;
  }

  return sanitizePreferenceMap({
    ...defaults,
    ...(row.categories as Record<string, unknown>),
  });
}

export async function saveUserNotificationPreferences(
  userId: string,
  categories: Partial<Record<NotificationCategory, Partial<NotificationChannelPreference>>>
) {
  const current = await getUserNotificationPreferences(userId);
  const next = cloneDefaults();
  for (const category of NOTIFICATION_CATEGORIES) {
    next[category] = { ...current[category] };
    const patch = categories[category];
    if (!patch) continue;
    if (typeof patch.web === "boolean") next[category].web = patch.web;
    if (typeof patch.email === "boolean") next[category].email = patch.email;
    if (typeof patch.sms === "boolean") next[category].sms = patch.sms;
  }

  await db.userNotificationPreference.upsert({
    where: { userId },
    create: { userId, categories: next as any },
    update: { categories: next as any },
  });

  return next;
}

export async function canDeliverNotification(params: {
  userId: string | null | undefined;
  category: NotificationCategory;
  channel: NotificationChannel | "WEB";
  role?: Role | null;
  hasPhone?: boolean;
}) {
  if (!params.userId) return false;
  const prefs = await getUserNotificationPreferences(params.userId);
  const key = channelToKey(params.channel);
  if (key === "sms" && params.hasPhone === false) return false;
  return prefs[params.category][key];
}
