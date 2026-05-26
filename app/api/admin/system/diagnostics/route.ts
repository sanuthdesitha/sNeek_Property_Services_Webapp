import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pull global state set by the SSE stream + workers.
type SseState = { active: number };
type WorkerFailure = { jobName: string; at: string; error: string };
type JobRun = { name: string; ok: boolean; durationMs: number; error?: string; finishedAt: number };
const globalRef = globalThis as unknown as {
  __sneekSseLiveLocations?: SseState;
  __sneekWorkerFailures?: WorkerFailure[];
  __sneekJobRuns?: JobRun[];
};

type PgActivityRow = {
  pid: number;
  usename: string | null;
  state: string | null;
  query_start: Date | null;
  seconds: number | null;
  query: string | null;
};

type PgBossJobRow = { state: string; count: number };

type PgSlowQueryRow = {
  query: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== Role.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- Process ----------------------------------------------------------
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // CPU sample over 1s
  const cpuStart = process.cpuUsage();
  await new Promise((r) => setTimeout(r, 1000));
  const cpuEnd = process.cpuUsage(cpuStart);
  // cpuUsage returns microseconds. (user+system) / 1_000_000 = CPU-seconds
  // consumed in our 1-second wall window → that's already a percent of one
  // core. Multiply by 100 to get %.
  const cpuPercent = ((cpuEnd.user + cpuEnd.system) / 1_000_000) * 100;

  // --- SSE state --------------------------------------------------------
  const sseActive = globalRef.__sneekSseLiveLocations?.active ?? 0;

  // --- Worker failures --------------------------------------------------
  const recentFailures = (globalRef.__sneekWorkerFailures ?? []).slice(-20).reverse();

  // --- Per-job runtime aggregation (last hour) --------------------------
  // Heaviest jobs by total wall time in the last hour. >10% of an hour is
  // suspicious, >25% is the CPU offender. This snapshot only sees runs
  // from the CURRENT process — if workers run in a separate container
  // from the web app (the recommended topology, see docs/ops/vps-triage.md
  // §10), this list will be empty here and visible only on the worker
  // container's stats. The UI calls this out so it's not misread as "no
  // jobs running".
  const allRuns = globalRef.__sneekJobRuns ?? [];
  const oneHourAgo = Date.now() - 60 * 60_000;
  const recentRuns = allRuns.filter((r) => r.finishedAt > oneHourAgo);
  const byJob: Record<string, { count: number; totalMs: number; failures: number; maxMs: number }> = {};
  for (const r of recentRuns) {
    const entry = (byJob[r.name] ??= { count: 0, totalMs: 0, failures: 0, maxMs: 0 });
    entry.count += 1;
    entry.totalMs += r.durationMs;
    if (!r.ok) entry.failures += 1;
    if (r.durationMs > entry.maxMs) entry.maxMs = r.durationMs;
  }
  const jobStats = Object.entries(byJob)
    .map(([name, s]) => ({
      name,
      count: s.count,
      totalMs: s.totalMs,
      maxMs: s.maxMs,
      failures: s.failures,
      percentOfHour: Math.round((s.totalMs / (60 * 60_000)) * 1000) / 10,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // --- Postgres ---------------------------------------------------------
  const pgActivity = await db
    .$queryRawUnsafe<PgActivityRow[]>(
      `SELECT pid, usename, state, query_start,
              EXTRACT(EPOCH FROM (NOW() - query_start))::int AS seconds,
              LEFT(query, 200) AS query
       FROM pg_stat_activity
       WHERE state != 'idle' AND datname = current_database()
       ORDER BY query_start NULLS LAST
       LIMIT 30`,
    )
    .catch(() => [] as PgActivityRow[]);

  const jobsByState = await db
    .$queryRawUnsafe<PgBossJobRow[]>(
      `SELECT state, COUNT(*)::int AS count
       FROM pgboss.job
       GROUP BY state`,
    )
    .catch(() => [] as PgBossJobRow[]);

  // pg_stat_statements is an extension — only present on some installs.
  // Gracefully skip if missing.
  const slowQueries = await db
    .$queryRawUnsafe<PgSlowQueryRow[]>(
      `SELECT LEFT(query, 200) AS query,
              calls::int AS calls,
              total_exec_time::int AS total_ms,
              mean_exec_time::int AS mean_ms
       FROM pg_stat_statements
       ORDER BY total_exec_time DESC
       LIMIT 10`,
    )
    .catch(() => [] as PgSlowQueryRow[]);

  return NextResponse.json({
    capturedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(uptime),
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memory: {
        rssMB: Math.round(mem.rss / 1024 / 1024),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      },
      nodeVersion: process.version,
      platform: process.platform,
    },
    sse: {
      liveLocationsActive: sseActive,
    },
    workers: {
      recentFailures,
      jobStats,
      runsObserved: allRuns.length,
    },
    db: {
      activeQueries: pgActivity.map((r) => ({
        pid: r.pid,
        user: r.usename,
        state: r.state,
        seconds: r.seconds ?? 0,
        query: r.query ?? "",
      })),
      jobsByState,
      slowQueries,
    },
  });
}
