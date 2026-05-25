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
const globalRef = globalThis as unknown as {
  __sneekSseLiveLocations?: SseState;
  __sneekWorkerFailures?: WorkerFailure[];
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
