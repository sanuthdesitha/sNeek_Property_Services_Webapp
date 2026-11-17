"use client";

/**
 * The earlier Diagnostics tabs, kept inside System health (2026-11-16):
 * Server (live 5s poll of /api/admin/system/diagnostics; was "System"),
 * Email (suppression list; removing an address asks a tier A confirmation)
 * and Uploads (unresolved failures). No dependency on components/{ui,admin}.
 */
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { EBadge, EEmptyState, EButton, EStatCard, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";

export type EmailRow = { email: string; reason: string | null; createdAt: string | null };
export type UploadRow = { id: string; reason: string; occurredAt: string | null; user: string | null; job: string | null; detail?: string | null };
type Band = "good" | "warn" | "bad";
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

export function ServerTab({ supportText }: { supportText: string | null }) {
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
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Auto-refreshing every 5 seconds. Stored schedules, iCal worker evidence and slow queries:{" "}
          <a href="/admin/system/diagnostics" className="underline underline-offset-2">classic diagnostics</a>.
        </p>
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

      {supportText ? (
        <ECard>
          <ECardBody className="pt-6">
            <label htmlFor="health-support-text" className="mb-2 block text-[0.75rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Support details</label>
            <p className="mb-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">The same text as &quot;Copy details for support&quot;: times, task names, counts and error text, with no passwords, keys, tokens or client details.</p>
            <textarea id="health-support-text" readOnly value={supportText} rows={8} className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-2 font-mono text-[16px] sm:text-[0.75rem]" />
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}

const REASON_WORDS: Record<string, string> = {
  HARD_BOUNCE: "Hard bounce",
  SOFT_BOUNCE: "Soft bounce",
  COMPLAINT: "Complaint",
  UNSUBSCRIBED: "Unsubscribed",
  MARKETING_OPT_OUT: "Opted out of marketing",
};

export function EmailTab({ rows }: { rows: EmailRow[] }) {
  const [list, setList] = useState(rows);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function unsuppress() {
    const address = confirming;
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/system/email/${encodeURIComponent(address)}/unsuppress`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(`It was not removed: ${body?.error ?? "the server refused the request"}.`);
        return;
      }
      setList((current) => current.filter((row) => row.email !== address));
      setDone(`${address} was removed from the bounce list. Emails to it will be tried again.`);
      setConfirming(null);
    } catch {
      setError("It was not removed: the server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p role="status" className="text-[0.8125rem]">{done}</p>
      {!list.length ? (
        <EEmptyState eyebrow="Email" title="No address on the bounce list" description="Nothing on the suppression list, so no address is skipped." />
      ) : (
        <ETableShell phoneStack headers={[{ label: "Address" }, { label: "Reason" }, { label: "Since" }, { label: "", align: "right" }]}>
          {list.map((r) => (
            <tr key={r.email} className="border-t border-[hsl(var(--e-border))]">
              <td className="break-all px-4 py-2.5 font-mono text-[0.75rem]">{r.email}</td>
              <td className="px-4 py-2.5 text-[0.8125rem]">{r.reason ? REASON_WORDS[r.reason] ?? r.reason : "—"}</td>
              <td className="px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{fmt(r.createdAt)}</td>
              <td className="px-4 py-2.5 text-right">
                <EButton variant="outline" size="sm" onClick={() => { setError(null); setConfirming(r.email); }}>
                  Remove from list…
                </EButton>
              </td>
            </tr>
          ))}
        </ETableShell>
      )}
      <EConfirmDialog
        open={confirming !== null}
        onClose={() => { if (!busy) setConfirming(null); }}
        tier="ordinary"
        title={`Remove ${confirming ?? ""} from the bounce list?`}
        description="Emails to this address will be tried again."
        confirmLabel="Remove from list"
        busy={busy}
        error={error}
        onConfirm={() => unsuppress()}
      />
    </div>
  );
}

export function UploadsTab({ rows }: { rows: UploadRow[] }) {
  if (!rows.length) {
    return <EEmptyState eyebrow="Uploads" title="No unresolved failures" description="Every upload has succeeded or been resolved." />;
  }
  return (
    <ETableShell headers={[{ label: "When" }, { label: "Reason" }, { label: "User" }, { label: "Job" }]}>
      {rows.map((r) => (
        <tr key={r.id} className="border-t border-[hsl(var(--e-border))]">
          <td className="px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{fmt(r.occurredAt)}</td>
          <td className="px-4 py-2.5 text-[0.8125rem]">
            {r.reason}
            {r.detail ? <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{r.detail}</p> : null}
          </td>
          <td className="px-4 py-2.5 text-[0.8125rem]">{r.user ?? "—"}</td>
          <td className="px-4 py-2.5 text-[0.8125rem]">{r.job ?? "—"}</td>
        </tr>
      ))}
    </ETableShell>
  );
}
