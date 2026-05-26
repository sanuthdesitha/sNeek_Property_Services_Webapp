"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Snapshot = {
  capturedAt: string;
  os?: {
    platform: string;
    cpuCount: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    totalMemMB: number;
    freeMemMB: number;
    cpuStealPercent: number | null;
  };
  process: {
    pid: number;
    uptimeSeconds: number;
    cpuPercent: number;
    memory: { rssMB: number; heapUsedMB: number; heapTotalMB: number; externalMB: number };
    nodeVersion: string;
    platform: string;
  };
  sse: { liveLocationsActive: number };
  workers: {
    recentFailures: { jobName: string; at: string; error: string }[];
    jobStats: { name: string; count: number; totalMs: number; maxMs: number; failures: number; percentOfHour: number }[];
    runsObserved: number;
  };
  db: {
    activeQueries: { pid: number; user: string | null; state: string | null; seconds: number; query: string }[];
    jobsByState: { state: string; count: number }[];
    slowQueries: { query: string; calls: number; total_ms: number; mean_ms: number }[];
  };
};

type ChartPoint = { t: string; cpu: number; heap: number };

const POLL_MS = 5_000;
const MAX_POINTS = 60_000 / POLL_MS; // ~60s rolling window at 5s cadence

function band(value: number, green: number, yellow: number) {
  if (value < green) return "good";
  if (value < yellow) return "warn";
  return "bad";
}

function BandPill({ status, children }: { status: "good" | "warn" | "bad"; children: React.ReactNode }) {
  const cls =
    status === "good"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : status === "warn"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "bg-destructive/15 text-destructive";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  status,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  status?: "good" | "warn" | "bad";
  sub?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        {status ? <BandPill status={status}>{status === "good" ? "OK" : status === "warn" ? "WARN" : "ALERT"}</BandPill> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

function formatUptime(secs: number) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return `${m}m ${remS}s`;
}

function jobLoadBand(percent: number): "good" | "warn" | "bad" {
  if (percent >= 25) return "bad";
  if (percent >= 10) return "warn";
  return "good";
}

export function DiagnosticsClient() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChartPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/admin/system/diagnostics", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Snapshot;
        if (cancelled) return;
        setSnap(body);
        setError(null);
        setHistory((prev) => {
          const next: ChartPoint[] = [
            ...prev,
            {
              t: new Date(body.capturedAt).toLocaleTimeString(),
              cpu: body.process.cpuPercent,
              heap: body.process.memory.heapUsedMB,
            },
          ];
          if (next.length > MAX_POINTS) next.splice(0, next.length - MAX_POINTS);
          return next;
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (error && !snap) {
    return <Card className="p-6 text-sm text-destructive">Failed to load: {error}</Card>;
  }
  if (!snap) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>;
  }

  const cpuBand = band(snap.process.cpuPercent, 60, 85);
  const heapBand = band(snap.process.memory.heapUsedMB, 300, 700);
  const rssBand = band(snap.process.memory.rssMB, 500, 1200);
  const longestQuery = snap.db.activeQueries[0]?.seconds ?? 0;
  const queryBand = band(longestQuery, 10, 30);
  const failedJobs = snap.db.jobsByState.find((j) => j.state === "failed")?.count ?? 0;
  const retryJobs = snap.db.jobsByState.find((j) => j.state === "retry")?.count ?? 0;
  const jobBand: "good" | "warn" | "bad" =
    failedJobs > 0 ? "bad" : retryJobs > 0 ? "warn" : "good";

  const os = snap.os;
  const stealCritical = os?.cpuStealPercent != null && os.cpuStealPercent > 25;
  const loadSaturated = os ? os.loadAvg1m > os.cpuCount * 2 : false;

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          Last poll failed: {error}. Still showing the previous snapshot.
        </Card>
      ) : null}

      {os ? (
        <>
          {/* RED panic banner: steal time > 25% — the VPS hypervisor is throttling us */}
          {stealCritical ? (
            <Card className="border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-semibold text-destructive">
                VPS hypervisor is stealing CPU — {os.cpuStealPercent!.toFixed(0)}% steal time
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your hosting provider&apos;s physical host is oversold. The VM is starved of CPU
                cycles by other tenants. This is <strong>not</strong> a code problem — migrate
                to a CPU-dedicated VPS tier (Hetzner CPX, DigitalOcean CPU-Optimized, Linode
                Dedicated CPU, Vultr High Frequency) or open a support ticket with your current
                provider asking them to migrate this VPS to a less-loaded host node.
              </p>
            </Card>
          ) : null}

          {/* AMBER warning: load avg > 2× CPU count — system saturated */}
          {loadSaturated ? (
            <Card className="border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                System load saturated — {os.loadAvg1m.toFixed(2)} load on {os.cpuCount} CPUs
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run queue is more than twice the CPU count. Processes are waiting for CPU.
                Combined with the steal time figure, this confirms the host node is oversold —
                see <code className="rounded bg-surface-raised px-1 py-0.5">docs/ops/vps-triage.md §12</code>.
              </p>
            </Card>
          ) : null}

          {/* Always-visible OS stat tiles */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Load (1m)"
              value={os.loadAvg1m.toFixed(2)}
              status={loadSaturated ? "bad" : os.loadAvg1m > os.cpuCount ? "warn" : "good"}
              sub={`${os.cpuCount} CPU${os.cpuCount === 1 ? "" : "s"} · 5m ${os.loadAvg5m.toFixed(2)} · 15m ${os.loadAvg15m.toFixed(2)}`}
            />
            <StatCard
              label="CPU steal"
              value={os.cpuStealPercent != null ? `${os.cpuStealPercent.toFixed(0)}%` : "—"}
              status={
                os.cpuStealPercent == null
                  ? undefined
                  : os.cpuStealPercent > 25
                    ? "bad"
                    : os.cpuStealPercent > 5
                      ? "warn"
                      : "good"
              }
              sub={os.cpuStealPercent != null ? "hypervisor stolen cycles" : "Linux-only metric"}
            />
            <StatCard
              label="Free RAM"
              value={`${os.freeMemMB} MB`}
              status={
                os.freeMemMB < os.totalMemMB * 0.1
                  ? "bad"
                  : os.freeMemMB < os.totalMemMB * 0.2
                    ? "warn"
                    : "good"
              }
              sub={`of ${os.totalMemMB} MB total`}
            />
            <StatCard
              label="OS"
              value={os.platform}
              sub={`${(os.totalMemMB / 1024).toFixed(1)} GB RAM · ${os.cpuCount} vCPU`}
            />
          </div>
        </>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="CPU"
          value={`${snap.process.cpuPercent.toFixed(1)}%`}
          status={cpuBand}
          sub={`PID ${snap.process.pid} · ${snap.process.platform} · Node ${snap.process.nodeVersion}`}
        />
        <StatCard
          label="Heap"
          value={`${snap.process.memory.heapUsedMB} MB`}
          status={heapBand}
          sub={`of ${snap.process.memory.heapTotalMB} MB · external ${snap.process.memory.externalMB} MB`}
        />
        <StatCard
          label="RSS"
          value={`${snap.process.memory.rssMB} MB`}
          status={rssBand}
          sub={`uptime ${formatUptime(snap.process.uptimeSeconds)}`}
        />
        <StatCard
          label="SSE connections"
          value={snap.sse.liveLocationsActive}
          status={snap.sse.liveLocationsActive >= 40 ? "bad" : snap.sse.liveLocationsActive >= 25 ? "warn" : "good"}
          sub="Live-locations stream · cap 50 · 10-min lifetime"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">CPU % (last ~60s)</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} />
                <Tooltip />
                <Line type="monotone" dataKey="cpu" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Heap MB (last ~60s)</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} />
                <Tooltip />
                <Area type="monotone" dataKey="heap" stroke="hsl(var(--primary))" fill="hsl(var(--primary)/0.18)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">pg-boss queue</h2>
          <BandPill status={jobBand}>
            {failedJobs > 0 ? `${failedJobs} failed` : retryJobs > 0 ? `${retryJobs} retrying` : "healthy"}
          </BandPill>
        </div>
        {snap.db.jobsByState.length === 0 ? (
          <p className="text-xs text-muted-foreground">No jobs in queue (or pgboss.job table not accessible).</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {snap.db.jobsByState.map((row) => (
              <span key={row.state} className="rounded-md border border-border bg-surface-raised px-3 py-1.5 text-xs">
                <span className="font-medium">{row.state}</span>
                <span className="ml-2 tabular-nums text-muted-foreground">{row.count}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Worker job runtime — last hour</h2>
          <span className="text-xs text-muted-foreground">
            {snap.workers.runsObserved} run{snap.workers.runsObserved === 1 ? "" : "s"} observed in this process
          </span>
        </div>
        {snap.workers.jobStats.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No worker job runs observed in this process. If workers run in a separate container from the web app
            (recommended — see docs/ops/vps-triage.md §10), check the worker container&apos;s logs directly. Otherwise
            no scheduled jobs have fired in the last hour yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Job</th>
                  <th className="py-1.5 pr-2 font-medium">Runs</th>
                  <th className="py-1.5 pr-2 font-medium">Total time</th>
                  <th className="py-1.5 pr-2 font-medium">Max run</th>
                  <th className="py-1.5 pr-2 font-medium">% of hour</th>
                  <th className="py-1.5 pr-2 font-medium">Failures</th>
                </tr>
              </thead>
              <tbody>
                {snap.workers.jobStats.map((j) => {
                  const b = jobLoadBand(j.percentOfHour);
                  return (
                    <tr key={j.name} className="border-b border-border/40">
                      <td className="py-1.5 pr-2 font-mono text-[11px]">{j.name}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{j.count}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{formatDuration(j.totalMs)}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{formatDuration(j.maxMs)}</td>
                      <td className="py-1.5 pr-2">
                        <BandPill status={b}>{j.percentOfHour}%</BandPill>
                      </td>
                      <td className={cn("py-1.5 pr-2 tabular-nums", j.failures > 0 ? "text-destructive" : "")}>
                        {j.failures}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Yellow ≥10%, red ≥25% of an hour of wall time. A red row is almost certainly the CPU offender — disable it with{" "}
              <code className="rounded bg-surface-raised px-1 py-0.5">SNEEK_DISABLED_JOBS=&lt;name&gt;</code> and restart the worker.
            </p>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent worker failures</h2>
          <span className="text-xs text-muted-foreground">In-process · last 20</span>
        </div>
        {snap.workers.recentFailures.length === 0 ? (
          <p className="text-xs text-muted-foreground">No failures recorded since this worker process started.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {snap.workers.recentFailures.map((f, i) => (
              <li key={i} className="rounded-md border border-border bg-surface-raised p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{f.jobName}</span>
                  <span className="text-muted-foreground">{new Date(f.at).toLocaleString()}</span>
                </div>
                <p className="mt-1 break-all font-mono text-[11px] text-destructive">{f.error}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Active Postgres queries</h2>
          <BandPill status={queryBand}>
            {longestQuery > 0 ? `${longestQuery}s longest` : "idle"}
          </BandPill>
        </div>
        {snap.db.activeQueries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active non-idle queries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">PID</th>
                  <th className="py-1.5 pr-2 font-medium">State</th>
                  <th className="py-1.5 pr-2 font-medium">Age</th>
                  <th className="py-1.5 pr-2 font-medium">Query</th>
                </tr>
              </thead>
              <tbody>
                {snap.db.activeQueries.map((q) => (
                  <tr key={q.pid} className="border-b border-border/40">
                    <td className="py-1.5 pr-2 tabular-nums">{q.pid}</td>
                    <td className="py-1.5 pr-2">{q.state}</td>
                    <td className={cn("py-1.5 pr-2 tabular-nums", q.seconds > 30 ? "text-destructive" : q.seconds > 10 ? "text-amber-600" : "")}>
                      {q.seconds}s
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] break-all">{q.query}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Top 10 slowest queries (lifetime)</h2>
          <span className="text-xs text-muted-foreground">pg_stat_statements · best-effort</span>
        </div>
        {snap.db.slowQueries.length === 0 ? (
          <p className="text-xs text-muted-foreground">pg_stat_statements is not enabled on this database.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Calls</th>
                  <th className="py-1.5 pr-2 font-medium">Total ms</th>
                  <th className="py-1.5 pr-2 font-medium">Mean ms</th>
                  <th className="py-1.5 pr-2 font-medium">Query</th>
                </tr>
              </thead>
              <tbody>
                {snap.db.slowQueries.map((q, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1.5 pr-2 tabular-nums">{q.calls}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{q.total_ms.toLocaleString()}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{q.mean_ms}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] break-all">{q.query}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Last captured at {new Date(snap.capturedAt).toLocaleString()}
      </p>
    </div>
  );
}
