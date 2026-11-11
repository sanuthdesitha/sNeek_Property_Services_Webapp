import "server-only";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { summarizeWorkerHeartbeats, WORKER_HEARTBEAT_PREFIX, type WorkerHealth } from "@/lib/ops/worker-heartbeat";
import { getSmsProviderState } from "./sms";
import { isWebPushConfigured } from "./web-push";
import { fallbackTypes } from "./catalog";
import type { NotificationTransport } from "./catalog-types";
import { directPathBanners, outboxTransportsFromEnv, OUTBOX_TRANSPORTS_ENV, type PathBanner } from "./transport-paths";

/**
 * Read model for the Health tab. Reports whether credentials are PRESENT,
 * never their values, plus switches, queue depth, failures and the worker.
 * What cannot be known from the database is said, not guessed.
 */
export type TransportHealth = {
  transport: NotificationTransport;
  configured: boolean | null;
  configuredNote: string;
  enabledNote: string;
  onPipeline: boolean;
  queued: number;
  oldestQueuedAt: string | null;
  failures24h: number;
};

export type NotificationHealth = {
  checkedAt: string;
  transports: TransportHealth[];
  envFlags: Array<{ name: string; value: string; effect: string }>;
  masterSwitches: { email: boolean; sms: boolean; push: boolean; automaticEmail: boolean };
  worker: WorkerHealth & { intentDispatcherActive: boolean | null };
  intentStatusCounts: Record<string, number>;
  banners: PathBanner[];
  unknowns: string[];
};

/** Non-secret switches only; their values are shown as set. Secrets are never listed here. */
const ENV_FLAGS: Array<{ name: string; effect: string }> = [
  { name: OUTBOX_TRANSPORTS_ENV, effect: "Which external transports (EMAIL, SMS, WEB_PUSH) the pipeline sends. Empty = pipeline sends inbox rows only; fallback types use the direct path." },
  { name: "SNEEK_WORKERS_ENABLED", effect: "Must be true on the worker container for scheduled notifications and the queues to run." },
  { name: "SNEEK_WORKERS_DISABLED", effect: "true stops all workers in this process." },
  { name: "SNEEK_EMBEDDED_WORKER", effect: "false stops the worker embedded in the web container." },
  { name: "SNEEK_WEB_SCHEDULER_ENABLED", effect: "false stops the embedded web scheduler." },
  { name: "SNEEK_DISABLED_JOBS", effect: "Worker jobs switched off by name (e.g. notification-intent-dispatch, mobile-notification-dispatch, reminder-dispatch)." },
  { name: "SNEEK_ENABLED_JOBS", effect: "When set, only these worker jobs run." },
];

const DAY_MS = 24 * 60 * 60_000;

async function intentQueue(transport: string, since: Date) {
  const [queued, oldest, failures] = await Promise.all([
    db.notificationIntent.count({ where: { transport, status: { in: ["QUEUED", "RETRY_WAIT", "PROCESSING"] } } }),
    db.notificationIntent.findFirst({ where: { transport, status: { in: ["QUEUED", "RETRY_WAIT"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.notificationIntent.count({ where: { transport, status: { in: ["FAILED", "UNCERTAIN"] }, updatedAt: { gte: since } } }),
  ]);
  return { queued, oldest: oldest?.createdAt ?? null, failures };
}

export async function readNotificationHealth(now = new Date()): Promise<NotificationHealth> {
  const since = new Date(now.getTime() - DAY_MS);
  const outbox = outboxTransportsFromEnv();
  const [settings, sms, webPush, heartbeats, inbox, email, smsQueue, push, mobilePending, mobileOldest, mobileFailures, directFailures, statusGroups] = await Promise.all([
    getAppSettings(),
    getSmsProviderState(),
    isWebPushConfigured(),
    db.appSetting.findMany({ where: { key: { startsWith: WORKER_HEARTBEAT_PREFIX } }, select: { value: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
    intentQueue("INBOX", since),
    intentQueue("EMAIL", since),
    intentQueue("SMS", since),
    intentQueue("WEB_PUSH", since),
    db.notification.count({ where: { channel: "PUSH", externalId: { startsWith: "mobile-outbox:pending" } } }),
    db.notification.findFirst({ where: { channel: "PUSH", externalId: { startsWith: "mobile-outbox:pending" } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.notification.count({ where: { channel: "PUSH", externalId: { in: ["mobile-outbox:FAILED", "mobile-outbox:UNCERTAIN", "mobile-outbox:REVIEW_REQUIRED"] }, createdAt: { gte: since } } }),
    db.notification.groupBy({ by: ["channel"], where: { status: "FAILED", createdAt: { gte: since } }, _count: { _all: true } }),
    db.notificationIntent.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const directFailed = (channel: string) => directFailures.find((row) => row.channel === channel)?._count._all ?? 0;
  const controls = settings.notificationAudienceControls;
  const automation = settings.emailAutomation;
  const worker = summarizeWorkerHeartbeats(heartbeats, now);
  const liveJobs = heartbeats.filter((row) => now.getTime() - row.updatedAt.getTime() < 3 * 60_000)
    .map((row) => (row.value as { registeredJobs?: unknown } | null)?.registeredJobs);
  const knowsJobs = liveJobs.some(Array.isArray);
  const iso = (date: Date | null) => date?.toISOString() ?? null;

  const transports: TransportHealth[] = [
    { transport: "INBOX", configured: true, configuredNote: "Built in.", enabledNote: "Always on; pipeline inbox rows are delivered by the worker every five minutes (office sends deliver at once).", onPipeline: true, queued: inbox.queued, oldestQueuedAt: iso(inbox.oldest), failures24h: inbox.failures },
    { transport: "MOBILE_PUSH", configured: true, configuredNote: "Expo push needs no key; phones must have registered a device.", enabledNote: controls?.channels?.push === false ? "Push master switch is OFF." : "On; dispatched every minute by the mobile outbox worker.", onPipeline: false, queued: mobilePending, oldestQueuedAt: iso(mobileOldest?.createdAt ?? null), failures24h: mobileFailures },
    { transport: "WEB_PUSH", configured: webPush, configuredNote: webPush ? "Browser push keys present." : "Browser push keys (VAPID) missing.", enabledNote: outbox.includes("WEB_PUSH") ? "Pipeline transport ON." : "Pipeline transport OFF: fallback types send browser push directly.", onPipeline: outbox.includes("WEB_PUSH"), queued: push.queued, oldestQueuedAt: iso(push.oldest), failures24h: push.failures },
    { transport: "EMAIL", configured: Boolean(process.env.RESEND_API_KEY?.trim()), configuredNote: process.env.RESEND_API_KEY?.trim() ? "Email provider key present." : "Email provider key (RESEND_API_KEY) missing: no email can be sent.", enabledNote: outbox.includes("EMAIL") ? "Pipeline transport ON." : "Pipeline transport OFF: fallback types send email directly.", onPipeline: outbox.includes("EMAIL"), queued: email.queued, oldestQueuedAt: iso(email.oldest), failures24h: email.failures + directFailed("EMAIL") },
    { transport: "SMS", configured: sms.provider === "none" ? null : sms.configured, configuredNote: sms.provider === "none" ? "SMS provider set to none (switched off in Integrations)." : sms.configured ? `SMS provider ${sms.provider} credentials present.` : `SMS provider ${sms.provider} credentials missing.`, enabledNote: outbox.includes("SMS") ? "Pipeline transport ON." : "Pipeline transport OFF (no fallback type uses SMS today).", onPipeline: outbox.includes("SMS"), queued: smsQueue.queued, oldestQueuedAt: iso(smsQueue.oldest), failures24h: smsQueue.failures + directFailed("SMS") },
  ];

  return {
    checkedAt: now.toISOString(),
    transports,
    envFlags: ENV_FLAGS.map((flag) => ({ ...flag, value: process.env[flag.name]?.trim() || "(not set)" })),
    masterSwitches: { email: controls?.channels?.email !== false, sms: controls?.channels?.sms !== false, push: controls?.channels?.push !== false, automaticEmail: automation?.masterEnabled !== false },
    worker: { ...worker, intentDispatcherActive: knowsJobs ? liveJobs.some((jobs) => Array.isArray(jobs) && jobs.includes("notification-intent-dispatch")) : null },
    intentStatusCounts: Object.fromEntries(statusGroups.map((row) => [row.status, row._count._all])),
    banners: directPathBanners(fallbackTypes()),
    unknowns: [
      "Direct browser pushes record no outcome, so their failures are not counted.",
      "Provider delivery is only known where the email provider's webhook reports it.",
      ...(knowsJobs ? [] : ["The running worker did not report its job list, so whether the pipeline dispatcher is registered is unknown."]),
    ],
  };
}
