import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Browser / PWA Web Push (VAPID) delivery.
 *
 * This is the desktop + Android + iOS-PWA push channel. It is separate from the
 * Expo native push channel (lib/notifications/mobile-push.ts) and the in-app
 * Notification feed. If VAPID env keys are missing it no-ops gracefully so the
 * rest of the notification pipeline (email/SMS/in-app) keeps working.
 */

export type WebPushPayload = {
  title: string;
  body: string;
  /** Deep-link path or absolute URL opened when the notification is clicked. */
  url?: string | null;
  /** Optional override icon/badge (defaults to the app icon). */
  icon?: string | null;
  badge?: string | null;
  /** Optional grouping tag so repeat notifications collapse. */
  tag?: string | null;
};

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

let configured: boolean | null = null;
let missingKeysWarned = false;

async function configureWebPush(): Promise<boolean> {
  if (configured !== null) return configured;

  // Settings-first: prefer VAPID keys saved in the integrations settings, fall
  // back to environment variables only when the setting is empty.
  let publicKey = "";
  let privateKey = "";
  let subjectRaw = "";
  try {
    const row = await db.appSetting.findUnique({ where: { key: "integrationCredentials" } });
    const creds = (row?.value as Record<string, string> | null) ?? {};
    publicKey = (creds.vapidPublicKey || process.env.VAPID_PUBLIC_KEY || "").trim();
    privateKey = (creds.vapidPrivateKey || process.env.VAPID_PRIVATE_KEY || "").trim();
    subjectRaw = (creds.vapidSubject || process.env.VAPID_SUBJECT || "").trim();
  } catch {
    publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
    privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
    subjectRaw = process.env.VAPID_SUBJECT?.trim() || "";
  }

  if (!publicKey || !privateKey) {
    configured = false;
    if (!missingKeysWarned) {
      missingKeysWarned = true;
      logger.warn(
        "Web Push disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set. Browser push notifications will be skipped."
      );
    }
    return false;
  }

  // web-push requires a contact subject (mailto: or https URL).
  let subject = subjectRaw || "";
  if (!/^mailto:|^https?:\/\//i.test(subject)) {
    subject = subject ? `mailto:${subject}` : "mailto:admin@sneekproservices.com.au";
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    configured = false;
    if (!missingKeysWarned) {
      missingKeysWarned = true;
      logger.warn({ err }, "Web Push disabled: failed to configure VAPID details.");
    }
  }
  return configured;
}

/** True when VAPID keys are present and web-push is configured. */
export async function isWebPushConfigured(): Promise<boolean> {
  return configureWebPush();
}

function buildNotificationPayload(payload: WebPushPayload) {
  return JSON.stringify({
    title: payload.title?.trim() || "sNeek update",
    body: payload.body ?? "",
    url: payload.url?.trim() || "/",
    icon: payload.icon?.trim() || "/icon-192.png",
    badge: payload.badge?.trim() || "/icon-192.png",
    tag: payload.tag?.trim() || undefined,
    timestamp: Date.now(),
  });
}

type SendResult = { ok: boolean; gone: boolean; statusCode?: number };

/**
 * Send a push to a single stored subscription.
 * Returns { gone: true } when the subscription is dead (404/410) so the caller
 * can prune it.
 */
export async function sendWebPush(
  subscription: StoredPushSubscription,
  payload: WebPushPayload
): Promise<SendResult> {
  if (!(await configureWebPush())) return { ok: false, gone: false };

  const target: WebPushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await webpush.sendNotification(target, buildNotificationPayload(payload), {
      TTL: 60 * 60 * 24, // keep for up to 24h while device is offline
      urgency: "high",
    });
    return { ok: true, gone: false };
  } catch (err: any) {
    const statusCode: number | undefined =
      typeof err?.statusCode === "number" ? err.statusCode : undefined;
    // 404 Not Found / 410 Gone => subscription is permanently invalid.
    const gone = statusCode === 404 || statusCode === 410;
    if (!gone) {
      logger.warn(
        { statusCode, endpoint: subscription.endpoint },
        "Web push send failed"
      );
    }
    return { ok: false, gone, statusCode };
  }
}

/**
 * Send a push to every browser/PWA subscription the user has registered.
 * Prunes any subscriptions the push service reports as gone (404/410).
 * Best-effort: never throws.
 */
export async function sendWebPushToUser(userId: string, payload: WebPushPayload): Promise<void> {
  if (!userId || typeof userId !== "string") return;
  if (!(await configureWebPush())) return;

  let subscriptions: Array<StoredPushSubscription & { id: string }>;
  try {
    subscriptions = await db.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  } catch (err) {
    logger.warn({ err, userId }, "Failed to load web push subscriptions");
    return;
  }

  if (subscriptions.length === 0) return;

  const goneIds: string[] = [];
  const liveIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendWebPush(sub, payload);
      if (result.gone) {
        goneIds.push(sub.id);
      } else if (result.ok) {
        liveIds.push(sub.id);
      }
    })
  );

  // Prune dead subscriptions.
  if (goneIds.length > 0) {
    try {
      await db.pushSubscription.deleteMany({ where: { id: { in: goneIds } } });
    } catch (err) {
      logger.warn({ err, count: goneIds.length }, "Failed to prune dead web push subscriptions");
    }
  }

  // Touch lastUsedAt on the ones we successfully delivered to.
  if (liveIds.length > 0) {
    try {
      await db.pushSubscription.updateMany({
        where: { id: { in: liveIds } },
        data: { lastUsedAt: new Date() },
      });
    } catch {
      // lastUsedAt is best-effort bookkeeping; ignore failures.
    }
  }
}
