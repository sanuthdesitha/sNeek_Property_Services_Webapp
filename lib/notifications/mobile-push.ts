import { PrismaClient, type Notification, type Role } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getAppSettings, type NotificationCategory } from "@/lib/settings";
import { getUserNotificationPreferences } from "./preferences";
import { audienceForRole, isChannelAllowed } from "./audience-controls";
import { isNotificationVisibleToRole, resolveNotificationHrefForRole } from "@/lib/notifications/feed";

const EXPO_PUSH_API_URL =
  process.env.EXPO_PUSH_API_URL?.trim() || "https://exp.host/--/api/v2/push/send";

type PushNotificationLike = Pick<Notification, "id" | "userId" | "jobId" | "subject" | "body">;

type RegisterUserPushDeviceInput = {
  userId: string;
  token: string;
  platform: string;
  appVersion?: string | null;
};

function normalizeToken(token: string) {
  return token.trim();
}

export function isExpoPushToken(token: string | null | undefined) {
  if (!token) return false;
  const trimmed = normalizeToken(token);
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(trimmed);
}

function buildAbsolutePath(path: string) {
  const appUrl = process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || "";
  if (!appUrl) return path;
  try {
    return new URL(path, appUrl).toString();
  } catch {
    return path;
  }
}

export async function registerUserPushDevice(prisma: PrismaClient, input: RegisterUserPushDeviceInput) {
  const token = normalizeToken(input.token);
  if (!isExpoPushToken(token)) {
    return null;
  }

  return prisma.userPushDevice.upsert({
    where: { token },
    create: {
      userId: input.userId,
      token,
      platform: input.platform.trim() || "unknown",
      appVersion: input.appVersion?.trim() || null,
      provider: "expo",
      isActive: true,
      lastSeenAt: new Date(),
    },
    update: {
      userId: input.userId,
      platform: input.platform.trim() || "unknown",
      appVersion: input.appVersion?.trim() || null,
      provider: "expo",
      isActive: true,
      lastSeenAt: new Date(),
    },
  });
}

export async function unregisterUserPushDevice(prisma: PrismaClient, userId: string, token: string) {
  const normalized = normalizeToken(token);
  if (!isExpoPushToken(normalized)) return;
  await prisma.userPushDevice.updateMany({
    where: { userId, token: normalized },
    data: { isActive: false, lastSeenAt: new Date() },
  });
}

async function sendExpoPushMessages(messages: Array<Record<string, unknown>>) {
  const response = await fetch(EXPO_PUSH_API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body?.errors?.[0]?.message === "string"
        ? body.errors[0].message
        : `Expo push API failed with status ${response.status}`
    );
  }

  const data = Array.isArray(body?.data) ? body.data : [];
  return data;
}

function messageForNotification(notification: PushNotificationLike, role: Role) {
  const href = resolveNotificationHrefForRole(notification, role);
  return {
    title: notification.subject?.trim() || "sNeek update",
    body: notification.body,
    href,
    url: buildAbsolutePath(href),
  };
}

async function disableInvalidExpoTokens(prisma: PrismaClient, tokens: string[]) {
  if (tokens.length === 0) return;
  await prisma.userPushDevice.updateMany({
    where: { token: { in: tokens } },
    data: { isActive: false, lastSeenAt: new Date() },
  });
}

export type MobilePushOutcome = "ACCEPTED" | "SKIPPED" | "FAILED" | "UNCERTAIN";

/** Called only after a committed notification has been durably claimed. */
export async function deliverMobilePushNotification(
  prisma: PrismaClient, notification: PushNotificationLike, category: NotificationCategory,
): Promise<MobilePushOutcome> {
  if (!notification.userId) return "SKIPPED";
  let providerCalled = false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: notification.userId }, select: { id: true, role: true, isActive: true },
    });
    if (!user?.isActive || !isNotificationVisibleToRole(notification, user.role)) return "SKIPPED";
    const [settings, preferences] = await Promise.all([getAppSettings(), getUserNotificationPreferences(user.id)]);
    if (!isChannelAllowed(settings.notificationAudienceControls, audienceForRole(user.role), "push")) return "SKIPPED";
    if (!preferences[category]?.web) return "SKIPPED";
    const devices = await prisma.userPushDevice.findMany({
      where: { userId: user.id, isActive: true, provider: "expo" }, select: { token: true },
    });
    const message = messageForNotification(notification, user.role);
    const messages = devices.map(device => device.token).filter(isExpoPushToken).map(token => ({
      to: token, title: message.title, body: message.body, sound: "default", priority: "high", channelId: "default",
      data: { path: message.href, url: message.url, jobId: notification.jobId, notificationId: notification.id },
    }));
    if (!messages.length) return "SKIPPED";
    providerCalled = true;
    const results = await sendExpoPushMessages(messages);
    const invalidTokens = results.flatMap((row: any, index: number) =>
      (row?.details?.error ?? row?.error) === "DeviceNotRegistered" ? [messages[index]?.to ?? ""] : []);
    await disableInvalidExpoTokens(prisma, invalidTokens.filter(Boolean));
    if (results.length !== messages.length) return "UNCERTAIN";
    if (results.every((row: any) => row?.status === "ok" && typeof row.id === "string")) return "ACCEPTED";
    // Partial acceptance cannot be safely retried as a whole notification.
    return results.some((row: any) => row?.status === "ok") ? "UNCERTAIN" : "FAILED";
  } catch (err) {
    logger.error({ err, notificationId: notification.id }, "Mobile outbox delivery failed");
    return providerCalled ? "UNCERTAIN" : "FAILED";
  }
}
