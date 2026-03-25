import { PrismaClient, type Notification, type Role } from "@prisma/client";
import { logger } from "@/lib/logger";
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

export async function dispatchMobilePushForNotifications(
  prisma: PrismaClient,
  notifications: PushNotificationLike[]
) {
  const items = notifications.filter(
    (item): item is PushNotificationLike & { userId: string } =>
      typeof item.userId === "string" && item.userId.trim().length > 0
  );
  if (items.length === 0) return;

  for (const notification of items) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: notification.userId },
        select: { id: true, role: true },
      });
      if (!user) continue;
      if (!isNotificationVisibleToRole(notification, user.role)) continue;

      const devices = await prisma.userPushDevice.findMany({
        where: { userId: user.id, isActive: true, provider: "expo" },
        select: { token: true },
      });
      if (devices.length === 0) continue;

      const message = messageForNotification(notification, user.role);
      const messages = devices
        .map((device) => device.token)
        .filter(isExpoPushToken)
        .map((token) => ({
          to: token,
          title: message.title,
          body: message.body,
          sound: "default",
          priority: "high",
          channelId: "default",
          data: {
            path: message.href,
            url: message.url,
            jobId: notification.jobId,
            notificationId: notification.id,
          },
        }));

      if (messages.length === 0) continue;

      const results = await sendExpoPushMessages(messages);
      const invalidTokens = results.flatMap((row: any, index: number) => {
        const error = row?.details?.error ?? row?.error ?? "";
        return error === "DeviceNotRegistered" ? [String(messages[index]?.to ?? "")] : [];
      });
      await disableInvalidExpoTokens(prisma, invalidTokens.filter(Boolean));
    } catch (err) {
      logger.error(
        {
          err,
          userId: notification.userId,
          notificationId: notification.id,
        },
        "Failed to dispatch mobile push notification"
      );
    }
  }
}
