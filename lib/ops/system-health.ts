import "server-only";
/**
 * System health facts (admin Diagnostics, 2026-11-16). Reads only: no
 * provider is called, nothing is written, no secret value leaves this module
 * (credentials are reported as present or not).
 *
 * Every read is independent: one that fails becomes "not readable" (null or
 * `readable: false`) for its own area, never zero or success.
 *
 * Scheduled work comes from pg-boss's own job rows (`pgboss.job` and
 * `pgboss.archive`, kept 7 days): since 2026-11-16 each run returns a run
 * record (lib/ops/worker-guard.ts) that pg-boss stores as the job's output.
 * Older rows have no output and read as "result not recorded".
 */
import { totalmem } from "node:os";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { summarizeWorkerHeartbeats, WORKER_HEARTBEAT_PREFIX } from "@/lib/ops/worker-heartbeat";
import { buildXeroStatus } from "@/lib/xero/connection-status";
import { readSafeguardSettings } from "@/lib/notifications/safeguards/store";
import { getSmsProviderState } from "@/lib/notifications/sms";
import { isWebPushConfigured } from "@/lib/notifications/web-push";
import { getServerMapsKey } from "@/lib/maps/server-key";
import { MARKETING_OPT_OUT } from "@/lib/email/suppression";
import { buildSystemHealthView } from "./system-health-model";
import type {
  AiFacts,
  DatabaseFacts,
  HealthFacts,
  IcalFacts,
  PaymentFacts,
  QueueFacts,
  SafeguardFacts,
  StorageFacts,
  SystemHealthView,
  TaskFacts,
  TaskRunFacts,
  TransportFacts,
  WorkerFacts,
  XeroFacts,
} from "./system-health-types";

const DAY_MS = 24 * 60 * 60_000;
const WORKER_TIME_ZONE = "Australia/Sydney";

async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/* ── Worker and scheduled work ───────────────────────────────────────────── */

async function readWorker(now: Date): Promise<WorkerFacts> {
  const rows = await settle(() => db.appSetting.findMany({
    where: { key: { startsWith: WORKER_HEARTBEAT_PREFIX } },
    select: { value: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  }));
  if (!rows) return { status: "UNREADABLE", lastSeenAt: null, registeredJobs: null };
  const summary = summarizeWorkerHeartbeats(rows, now);
  const live = rows.find((row) => now.getTime() - row.updatedAt.getTime() < 3 * 60_000);
  const jobs = (live?.value as { registeredJobs?: unknown } | null)?.registeredJobs;
  return {
    status: summary.status,
    lastSeenAt: summary.lastSeenAt,
    registeredJobs: Array.isArray(jobs) ? jobs.filter((name): name is string => typeof name === "string") : null,
  };
}

type RunRow = { name: string; state: string; finished_at: Date | null; output: unknown; rn: number };
type CountRow = { name: string; ok: number; failed: number; unknown: number };
type ScheduleRow = { name: string; cron: string; timezone: string | null };

function runFromRow(row: RunRow): TaskRunFacts | null {
  if (!row.finished_at) return null;
  const run = (row.output as { sneekRun?: { ok?: unknown; durationMs?: unknown; error?: unknown; skipped?: unknown } } | null)?.sneekRun;
  const failedState = row.state === "failed" || row.state === "expired" || row.state === "cancelled";
  return {
    at: row.finished_at.toISOString(),
    ok: failedState ? false : typeof run?.ok === "boolean" ? run.ok : null,
    durationMs: typeof run?.durationMs === "number" ? run.durationMs : null,
    error: typeof run?.error === "string" ? run.error : failedState ? `pg-boss marked the job ${row.state}` : null,
    skipped: run?.skipped === true,
  };
}

/** Recent rows from the live and archived job tables, as one relation. */
const RECENT_JOBS = `
  SELECT name, state, COALESCE(completedon, startedon) AS finished_at, output
  FROM pgboss.job
  WHERE state IN ('completed', 'failed', 'expired', 'cancelled') AND left(name, 10) <> '__pgboss__' AND COALESCE(completedon, startedon) > now() - interval '7 days'
  UNION ALL
  SELECT name, state, COALESCE(completedon, startedon) AS finished_at, output
  FROM pgboss.archive
  WHERE state IN ('completed', 'failed', 'expired', 'cancelled') AND left(name, 10) <> '__pgboss__' AND COALESCE(completedon, startedon) > now() - interval '7 days'`;

async function readTasks(): Promise<TaskFacts[] | null> {
  try {
    const [schedules, recent, counts] = await Promise.all([
      db.$queryRawUnsafe<ScheduleRow[]>(`SELECT name, cron, timezone FROM pgboss.schedule ORDER BY name`),
      db.$queryRawUnsafe<RunRow[]>(`
        SELECT name, state, finished_at, output, rn::int AS rn FROM (
          SELECT r.*, row_number() OVER (PARTITION BY name ORDER BY finished_at DESC) AS rn FROM (${RECENT_JOBS}) r
        ) ranked WHERE rn <= 6`),
      db.$queryRawUnsafe<CountRow[]>(`
        SELECT name,
          COUNT(*) FILTER (WHERE state = 'completed' AND output->'sneekRun'->>'ok' = 'true')::int AS ok,
          COUNT(*) FILTER (WHERE state <> 'completed' OR output->'sneekRun'->>'ok' = 'false')::int AS failed,
          COUNT(*) FILTER (WHERE state = 'completed' AND (output IS NULL OR output->'sneekRun' IS NULL))::int AS unknown
        FROM (${RECENT_JOBS}) r WHERE finished_at > now() - interval '24 hours' GROUP BY name`),
    ]);
    const lastFailures = await db.$queryRawUnsafe<RunRow[]>(`
      SELECT DISTINCT ON (name) name, state, finished_at, output, 1 AS rn FROM (${RECENT_JOBS}) r
      WHERE finished_at > now() - interval '24 hours' AND (state <> 'completed' OR output->'sneekRun'->>'ok' = 'false')
      ORDER BY name, finished_at DESC`);
    const names = new Set<string>(schedules.map((row) => row.name).filter((name) => !name.startsWith("__pgboss__")));
    for (const row of recent) names.add(row.name);
    return Array.from(names).map((name) => {
      const schedule = schedules.find((row) => row.name === name) ?? null;
      const runs = recent.filter((row) => row.name === name).sort((a, b) => a.rn - b.rn).map(runFromRow).filter((run): run is TaskRunFacts => run !== null);
      const count = counts.find((row) => row.name === name);
      const failure = lastFailures.find((row) => row.name === name);
      let failuresInARow = 0;
      for (const run of runs) {
        if (run.ok !== false) break;
        failuresInARow += 1;
      }
      return {
        name,
        cron: schedule?.cron ?? null,
        timeZone: schedule?.timezone ?? WORKER_TIME_ZONE,
        lastRun: runs[0] ?? null,
        lastFailure: failure ? runFromRow(failure) : null,
        ok24h: count?.ok ?? 0,
        failed24h: count?.failed ?? 0,
        unknown24h: count?.unknown ?? 0,
        failuresInARow,
      };
    });
  } catch {
    return null;
  }
}

async function readQueue(): Promise<QueueFacts | null> {
  const rows = await settle(() => db.$queryRawUnsafe<Array<{ waiting: number; running: number; retry: number; failed: number; done: number; stuck: number }>>(`
    SELECT
      (SELECT COUNT(*) FROM pgboss.job WHERE state = 'created' AND startafter <= now())::int AS waiting,
      (SELECT COUNT(*) FROM pgboss.job WHERE state = 'active')::int AS running,
      (SELECT COUNT(*) FROM pgboss.job WHERE state = 'retry')::int AS retry,
      (SELECT COUNT(*) FROM pgboss.job WHERE state IN ('failed', 'expired') AND COALESCE(completedon, startedon) > now() - interval '24 hours')::int
        + (SELECT COUNT(*) FROM pgboss.archive WHERE state IN ('failed', 'expired') AND COALESCE(completedon, startedon) > now() - interval '24 hours')::int AS failed,
      (SELECT COUNT(*) FROM pgboss.job WHERE state = 'completed' AND completedon > now() - interval '1 hour')::int AS done,
      (SELECT COUNT(*) FROM pgboss.job WHERE state = 'active' AND startedon + expirein < now())::int AS stuck`));
  const row = rows?.[0];
  if (!row) return null;
  return { waiting: row.waiting, running: row.running, willRetry: row.retry, failed24h: row.failed, doneLastHour: row.done, stuck: row.stuck };
}

/* ── Database ────────────────────────────────────────────────────────────── */

async function readDatabase(): Promise<DatabaseFacts> {
  const rows = await settle(() => db.$queryRawUnsafe<Array<{ pid: number; state: string | null; seconds: number | null; query: string | null }>>(`
    SELECT pid, state, EXTRACT(EPOCH FROM (NOW() - query_start))::int AS seconds, LEFT(query, 200) AS query
    FROM pg_stat_activity
    WHERE state <> 'idle' AND datname = current_database() AND pid <> pg_backend_pid()
    ORDER BY query_start NULLS LAST LIMIT 30`));
  if (rows) {
    return {
      reachable: true,
      runningQueries: rows.length,
      longestSeconds: rows.reduce((max, row) => Math.max(max, row.seconds ?? 0), 0),
      activeQueries: rows.map((row) => ({ pid: row.pid, seconds: row.seconds ?? 0, state: row.state, query: row.query ?? "" })),
    };
  }
  const reachable = (await settle(() => db.$queryRawUnsafe(`SELECT 1`))) !== null;
  return { reachable, runningQueries: null, longestSeconds: null, activeQueries: [] };
}

/* ── Outside services ────────────────────────────────────────────────────── */

async function readXero(now: Date): Promise<XeroFacts> {
  const unreadable: XeroFacts = { readable: false, notConnected: false, state: null, tenantName: null, lastRefreshedAt: null, renewBy: null, reason: null, lastSyncAt: null };
  const connection = await settle(() => db.xeroConnection.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } }));
  if (connection === null) {
    const count = await settle(() => db.xeroConnection.count({ where: { isActive: true } }));
    return count === 0 ? { ...unreadable, readable: true, notConnected: true } : unreadable;
  }
  const status = buildXeroStatus(connection, now);
  return {
    readable: true,
    notConnected: false,
    state: status.state,
    tenantName: status.tenantName,
    lastRefreshedAt: status.lastRefreshedAt,
    renewBy: status.renewBy,
    reason: status.reason,
    lastSyncAt: status.lastSyncAt ?? null,
  };
}

async function readSafeguards(): Promise<SafeguardFacts> {
  const [settings, paused] = await Promise.all([
    settle(() => readSafeguardSettings()),
    settle(() => db.outboundSafeguardIncident.findMany({ where: { status: "ACTIVE", pausesSending: true }, orderBy: { createdAt: "desc" }, take: 50, select: { label: true, detail: true, createdAt: true } })),
  ]);
  if (!settings || !paused) return { readable: false, emergencyStop: false, paused: [] };
  return {
    readable: true,
    emergencyStop: settings.emergencyStop.on,
    paused: paused.map((row) => ({
      label: row.label,
      transport: typeof (row.detail as { transport?: unknown } | null)?.transport === "string" ? String((row.detail as { transport: string }).transport) : null,
      since: row.createdAt.toISOString(),
    })),
  };
}

/** Sending-log counts for some transports over the last 24 hours. */
async function readTransport(transports: string[], since: Date): Promise<Omit<TransportFacts, "keyPresent" | "providerName">> {
  const empty = { handedOver24h: null, failed24h: null, notSent24h: null, pending24h: null, lastHandedOverAt: null, lastFailureAt: null };
  const where = { transport: { in: transports }, createdAt: { gte: since } };
  const result = await settle(() => Promise.all([
    db.outboundMessageEvent.groupBy({ by: ["decision", "outcome"], where, _count: { _all: true } }),
    db.outboundMessageEvent.findFirst({ where: { transport: { in: transports }, outcome: "ACCEPTED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.outboundMessageEvent.findFirst({ where: { transport: { in: transports }, outcome: "NOT_ACCEPTED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]));
  if (!result) return empty;
  const [groups, lastOk, lastFailed] = result;
  const total = (match: (decision: string, outcome: string | null) => boolean) => groups.filter((row) => match(row.decision, row.outcome)).reduce((sum, row) => sum + row._count._all, 0);
  return {
    handedOver24h: total((decision, outcome) => decision !== "SUPPRESSED" && outcome === "ACCEPTED"),
    failed24h: total((decision, outcome) => decision !== "SUPPRESSED" && (outcome === "NOT_ACCEPTED" || outcome === "UNCERTAIN")),
    notSent24h: total((decision) => decision === "SUPPRESSED"),
    pending24h: total((decision, outcome) => decision !== "SUPPRESSED" && outcome === null),
    lastHandedOverAt: lastOk?.createdAt.toISOString() ?? null,
    lastFailureAt: lastFailed?.createdAt.toISOString() ?? null,
  };
}

async function readStorage(): Promise<StorageFacts> {
  const [credentials, lastUpload, failures, oldest] = await Promise.all([
    settle(() => db.appSetting.findUnique({ where: { key: "integrationCredentials" }, select: { value: true } })),
    settle(() => db.submissionMedia.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })),
    settle(() => db.uploadFailure.count({ where: { resolvedAt: null } })),
    settle(() => db.uploadFailure.findFirst({ where: { resolvedAt: null }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } })),
  ]);
  const stored = (credentials?.value ?? null) as Record<string, unknown> | null;
  const storedKeys = Boolean(stored && typeof stored.awsAccessKeyId === "string" && stored.awsAccessKeyId && typeof stored.awsSecretAccessKey === "string" && stored.awsSecretAccessKey);
  const envKeys = Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
  const bucket = Boolean((stored && typeof stored.s3BucketName === "string" && stored.s3BucketName) || process.env.S3_BUCKET_NAME?.trim());
  return {
    keyPresent: (storedKeys || envKeys) && bucket,
    lastUploadAt: lastUpload?.createdAt.toISOString() ?? null,
    unresolvedFailures: failures,
    oldestUnresolvedAt: oldest?.occurredAt.toISOString() ?? null,
  };
}

async function readAi(since: Date): Promise<AiFacts> {
  const result = await settle(() => Promise.all([
    db.aiCall.groupBy({ by: ["outcome"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.aiCall.findFirst({ where: { outcome: "OK" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, provider: true, latencyMs: true } }),
    db.aiCall.findFirst({ where: { outcome: { not: "OK" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]));
  if (!result) return { readable: false, okCalls24h: 0, failedCalls24h: 0, lastOkAt: null, lastOkProvider: null, lastOkLatencyMs: null, lastFailureAt: null };
  const [groups, lastOk, lastFailure] = result;
  return {
    readable: true,
    okCalls24h: groups.filter((row) => row.outcome === "OK").reduce((sum, row) => sum + row._count._all, 0),
    failedCalls24h: groups.filter((row) => row.outcome !== "OK").reduce((sum, row) => sum + row._count._all, 0),
    lastOkAt: lastOk?.createdAt.toISOString() ?? null,
    lastOkProvider: lastOk?.provider ?? null,
    lastOkLatencyMs: lastOk?.latencyMs ?? null,
    lastFailureAt: lastFailure?.createdAt.toISOString() ?? null,
  };
}

async function readIcal(): Promise<IcalFacts> {
  const result = await settle(() => Promise.all([
    db.integration.findMany({
      where: { isEnabled: true, icalUrl: { not: null }, property: { isActive: true } },
      select: { propertyId: true, syncStatus: true, syncError: true, lastSyncAt: true, updatedAt: true, property: { select: { name: true } } },
    }),
    db.icalSyncRun.findFirst({ where: { mode: "AUTO" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]));
  if (!result) return { readable: false, enabledFeeds: 0, failing: [], lastRunAt: null };
  const [feeds, lastRun] = result;
  return {
    readable: true,
    enabledFeeds: feeds.length,
    failing: feeds
      .filter((feed) => feed.syncStatus === "ERROR")
      .map((feed) => ({ propertyId: feed.propertyId, propertyName: feed.property.name, since: (feed.lastSyncAt ?? feed.updatedAt).toISOString(), error: feed.syncError })),
    lastRunAt: lastRun?.createdAt.toISOString() ?? null,
  };
}

async function readPayments(): Promise<PaymentFacts> {
  const rows = await settle(() => db.paymentGateway.findMany({ where: { status: "ACTIVE" }, select: { provider: true }, orderBy: { priority: "asc" } }));
  if (!rows) return { readable: false, activeGateways: [] };
  return { readable: true, activeGateways: Array.from(new Set(rows.map((row) => String(row.provider)))) };
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

export async function readHealthFacts(now = new Date()): Promise<HealthFacts> {
  const since = new Date(now.getTime() - DAY_MS);
  const [settings, worker, tasks, queue, database, xero, safeguards, sms, webPushKeys, mapsKey, email, smsCounts, pushCounts, bounce, browsers, storage, ai, ical, payments] = await Promise.all([
    settle(() => getAppSettings()),
    readWorker(now),
    readTasks(),
    readQueue(),
    readDatabase(),
    readXero(now),
    readSafeguards(),
    settle(() => getSmsProviderState()),
    settle(() => isWebPushConfigured()),
    settle(() => getServerMapsKey()),
    readTransport(["EMAIL"], since),
    readTransport(["SMS"], since),
    readTransport(["WEB_PUSH", "MOBILE_PUSH"], since),
    settle(() => db.emailSuppression.count({ where: { reason: { not: MARKETING_OPT_OUT } } })),
    settle(() => db.pushSubscription.count()),
    readStorage(),
    readAi(since),
    readIcal(),
    readPayments(),
  ]);
  const mem = process.memoryUsage();
  return {
    checkedAt: now.toISOString(),
    timeZone: settings?.timezone || WORKER_TIME_ZONE,
    worker,
    tasks,
    queue,
    database,
    xero,
    safeguards,
    email: { ...email, keyPresent: Boolean(process.env.RESEND_API_KEY?.trim()), providerName: "Resend", bounceList: bounce },
    sms: { ...smsCounts, keyPresent: sms ? sms.provider === "none" ? null : sms.configured : null, providerName: sms ? String(sms.provider) : null },
    push: { ...pushCounts, keyPresent: webPushKeys, providerName: "Browser push and phone app", browsers },
    storage,
    maps: { keyPresent: mapsKey === null ? null : Boolean(mapsKey) },
    ai,
    ical,
    payments,
    server: { uptimeSeconds: Math.round(process.uptime()), rssMB: Math.round(mem.rss / 1024 / 1024), totalMemMB: Math.round(totalmem() / 1024 / 1024) },
  };
}

export async function readSystemHealth(now = new Date()): Promise<SystemHealthView> {
  return buildSystemHealthView(await readHealthFacts(now));
}
