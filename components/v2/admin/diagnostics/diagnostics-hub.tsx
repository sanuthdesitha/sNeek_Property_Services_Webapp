"use client";

/**
 * Estate-native diagnostics hub — System (live 5s poll of
 * /api/admin/system/diagnostics), Email (suppression list + unsuppress), and
 * Uploads (unresolved failures). No dependency on components/{ui,admin}.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Activity, Mail, Upload, RefreshCw, Loader2 } from "lucide-react";
import { EBadge, EEmptyState, EButton, EStatCard, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";

type Tab = "system" | "email" | "uploads";
type EmailRow = { email: string; reason: string | null; createdAt: string | null };
type UploadRow = { id: string; reason: string; occurredAt: string | null; user: string | null; job: string | null };
type Band = "good" | "warn" | "bad";

function bandTone(b: Band): "success" | "warning" | "danger" {
  return b === "good" ? "success" : b === "warn" ? "warning" : "danger";
}
// EStatCard.deltaTone has a narrower set (no "warning").
function deltaTone(b: Band): "success" | "danger" | "neutral" {
  return b === "good" ? "success" : b === "bad" ? "danger" : "neutral";
}
function fmt(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return ts;
  }
}

export function DiagnosticsHub({
  initialTab,
  email,
  uploads,
}: {
  initialTab?: string;
  email: EmailRow[];
  uploads: UploadRow[];
}) {
  const [tab, setTab] = useState<Tab>(
    initialTab === "email" || initialTab === "uploads" ? (initialTab as Tab) : "system"
  );

  const TABS: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "system", label: "System", icon: <Activity className="h-4 w-4" /> },
    { key: "email", label: "Email", icon: <Mail className="h-4 w-4" />, count: email.length },
    { key: "uploads", label: "Uploads", icon: <Upload className="h-4 w-4" />, count: uploads.length },
  ];

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
                tab === t.key
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
              )}
            >
              {t.icon}
              {t.label}
              {t.count ? (
                <span className="rounded-full bg-[hsl(var(--e-muted))] px-1.5 text-[0.6875rem]">{t.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {tab === "system" ? <SystemTab /> : null}
      {tab === "email" ? <EmailTab rows={email} /> : null}
      {tab === "uploads" ? <UploadsTab rows={uploads} /> : null}
    </div>
  );
}

function SystemTab() {
  const [snap, setSnap] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/admin/system/diagnostics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnap(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  if (loading && !snap) {
    return (
      <ECard>
        <ECardBody className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading diagnostics…
        </ECardBody>
      </ECard>
    );
  }
  if (error && !snap) {
    return <EEmptyState eyebrow="Diagnostics" title="Couldn't load" description={error} />;
  }

  const p = snap?.process ?? {};
  const mem = p.memory ?? {};
  const db = snap?.db ?? {};
  const workers = snap?.workers ?? {};
  const jobsByState: { state: string; count: number }[] = db.jobsByState ?? [];
  const failed = jobsByState.find((j) => j.state === "failed")?.count ?? 0;
  const retry = jobsByState.find((j) => j.state === "retry")?.count ?? 0;
  const heapRatio = mem.heapUsedMB && mem.heapTotalMB ? mem.heapUsedMB / mem.heapTotalMB : 0;
  const heapBand: Band = heapRatio > 0.9 ? "bad" : heapRatio > 0.75 ? "warn" : "good";
  const jobBand: Band = failed > 0 ? "bad" : retry > 0 ? "warn" : "good";
  const uptimeH = p.uptimeSeconds ? Math.floor(p.uptimeSeconds / 3600) : 0;
  const uptimeM = p.uptimeSeconds ? Math.floor((p.uptimeSeconds % 3600) / 60) : 0;
  const jobStats: { name: string; count: number; failures: number; percentOfHour: number }[] = workers.jobStats ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Auto-refreshing every 5 seconds.</p>
        <EButton variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </EButton>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Uptime" value={`${uptimeH}h ${uptimeM}m`} />
        <EStatCard label="Memory (RSS)" value={`${mem.rssMB ?? "—"} MB`} />
        <EStatCard
          label="Heap used"
          value={`${mem.heapUsedMB ?? "—"}/${mem.heapTotalMB ?? "—"} MB`}
          delta={heapBand === "good" ? "OK" : heapBand === "warn" ? "WARN" : "HIGH"}
          deltaTone={deltaTone(heapBand)}
        />
        <EStatCard
          label="Failed / retry jobs"
          value={`${failed} / ${retry}`}
          delta={jobBand === "good" ? "OK" : jobBand === "warn" ? "WATCH" : "ALERT"}
          deltaTone={deltaTone(jobBand)}
        />
      </section>

      {jobsByState.length ? (
        <ECard>
          <ECardBody>
            <p className="mb-3 text-[0.75rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Jobs by state</p>
            <div className="flex flex-wrap gap-2">
              {jobsByState.map((s) => (
                <EBadge key={s.state} tone={s.state === "failed" ? "danger" : s.state === "retry" ? "warning" : "neutral"}>
                  {s.state}: {s.count}
                </EBadge>
              ))}
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {jobStats.length ? (
        <ETableShell
          headers={[
            { label: "Worker / job" },
            { label: "Runs (last hr)" },
            { label: "Failures" },
            { label: "% of hour" },
          ]}
        >
          {jobStats.map((j) => (
            <tr key={j.name} className="border-t border-[hsl(var(--e-border))]">
              <td className="px-4 py-2.5 text-[0.8125rem] font-medium">{j.name}</td>
              <td className="px-4 py-2.5 text-[0.8125rem]">{j.count}</td>
              <td className="px-4 py-2.5 text-[0.8125rem]">
                {j.failures > 0 ? <EBadge tone="danger">{j.failures}</EBadge> : "0"}
              </td>
              <td className="px-4 py-2.5 text-[0.8125rem]">{Math.round(j.percentOfHour ?? 0)}%</td>
            </tr>
          ))}
        </ETableShell>
      ) : null}
    </div>
  );
}

function EmailTab({ rows }: { rows: EmailRow[] }) {
  const [list, setList] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);

  async function unsuppress(emailAddr: string) {
    setBusy(emailAddr);
    try {
      const res = await fetch(`/api/admin/system/email/${encodeURIComponent(emailAddr)}/unsuppress`, { method: "POST" });
      if (res.ok) setList((l) => l.filter((r) => r.email !== emailAddr));
    } finally {
      setBusy(null);
    }
  }

  if (!list.length) {
    return <EEmptyState eyebrow="Email" title="No suppressed addresses" description="Deliverability is healthy — nothing on the suppression list." />;
  }
  return (
    <ETableShell headers={[{ label: "Address" }, { label: "Reason" }, { label: "Since" }, { label: "", align: "right" }]}>
      {list.map((r) => (
        <tr key={r.email} className="border-t border-[hsl(var(--e-border))]">
          <td className="px-4 py-2.5 font-mono text-[0.75rem]">{r.email}</td>
          <td className="px-4 py-2.5 text-[0.8125rem]">{r.reason ?? "—"}</td>
          <td className="px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{fmt(r.createdAt)}</td>
          <td className="px-4 py-2.5 text-right">
            <EButton variant="outline" size="sm" disabled={busy === r.email} onClick={() => unsuppress(r.email)}>
              {busy === r.email ? "…" : "Unsuppress"}
            </EButton>
          </td>
        </tr>
      ))}
    </ETableShell>
  );
}

function UploadsTab({ rows }: { rows: UploadRow[] }) {
  if (!rows.length) {
    return <EEmptyState eyebrow="Uploads" title="No unresolved failures" description="Every upload has succeeded or been resolved." />;
  }
  return (
    <ETableShell headers={[{ label: "When" }, { label: "Reason" }, { label: "User" }, { label: "Job" }]}>
      {rows.map((r) => (
        <tr key={r.id} className="border-t border-[hsl(var(--e-border))]">
          <td className="px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{fmt(r.occurredAt)}</td>
          <td className="px-4 py-2.5 text-[0.8125rem]">{r.reason}</td>
          <td className="px-4 py-2.5 text-[0.8125rem]">{r.user ?? "—"}</td>
          <td className="px-4 py-2.5 text-[0.8125rem]">{r.job ?? "—"}</td>
        </tr>
      ))}
    </ETableShell>
  );
}
