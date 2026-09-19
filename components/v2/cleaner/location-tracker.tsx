"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useGpsTracker } from "@/lib/gps/client";
import { isTrackedStatus } from "@/lib/gps/tracked-statuses";
import { ActiveWorkStatus } from "./active-work-status";

const PROBE_INTERVAL_MS = 60_000;

const LABELS = { EN_ROUTE: "On the way", IN_PROGRESS: "In progress", PAUSED: "Paused" };
type ActiveJob = { id: string; status: keyof typeof LABELS; property: { name: string }; draftIdentity?: string; clock?: { running: boolean; startedAt: string | null }; checkedAt?: string };
type ProbeState = { scope: string; job: ActiveJob | null; failed: boolean; loading: boolean };

function parseJob(value: unknown): ActiveJob | null {
  if (!value || typeof value !== "object" || !("job" in value)) throw new Error("Invalid response");
  const job = value.job;
  if (job === null) return null;
  if (!job || typeof job !== "object" || !("id" in job) || typeof job.id !== "string"
    || !job.id.trim() || job.id !== job.id.trim() || /[\u0000-\u001f\u007f]/.test(job.id)
    || job.id === "." || job.id === ".."
    || !("status" in job) || typeof job.status !== "string" || !isTrackedStatus(job.status)
    || !Object.prototype.hasOwnProperty.call(LABELS, job.status)
    || !("property" in job) || !job.property || typeof job.property !== "object"
    || !("name" in job.property) || typeof job.property.name !== "string" || !job.property.name.trim()) {
    throw new Error("Invalid active job");
  }
  encodeURIComponent(job.id);
  const extra = job as Record<string, unknown>;
  const clock = extra.clock as ActiveJob["clock"];
  const validClock = typeof extra.draftIdentity === "string" && /^[a-f0-9]{64}$/.test(extra.draftIdentity) && clock && typeof clock.running === "boolean" &&
    ((clock.running && typeof clock.startedAt === "string" && Number.isFinite(Date.parse(clock.startedAt))) || (!clock.running && clock.startedAt === null)) &&
    typeof extra.checkedAt === "string" && Number.isFinite(Date.parse(extra.checkedAt)) && Date.parse(extra.checkedAt) <= Date.now() + 5000;
  return { id: job.id, status: job.status as ActiveJob["status"], property: { name: job.property.name.trim() },
    ...(validClock ? { draftIdentity: extra.draftIdentity as string, clock, checkedAt: extra.checkedAt as string } : {}) };
}

export function LocationTracker() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const scope = status === "authenticated" && session?.user?.id && session.user.role === "CLEANER"
    ? JSON.stringify([session.user.id, session.user.role, session.impersonation?.actorId,
      session.impersonation?.mode, session.impersonation?.startedAt]) : null;
  const [state, setState] = useState<ProbeState | null>(null);
  const activeScope = useRef<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    activeScope.current = scope;
    setState(null);
    return () => { activeScope.current = null; };
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let queued = false;
    const isCurrent = () => !disposed && activeScope.current === scope;
    async function probe() {
      if (!isCurrent()) return;
      if (controller) { queued = true; return; }
      controller = new AbortController();
      setState(previous => previous?.scope === scope ? { ...previous, loading: true }
        : { scope: scope!, job: null, failed: false, loading: true });
      try {
        const res = await fetch("/api/cleaner/location/active-job", {
          method: "GET",
          cache: "no-store",
          headers: { "x-progress-toast": "off" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Active job unavailable");
        const job = parseJob(await res.json());
        if (isCurrent()) setState({ scope: scope!, job, failed: false, loading: false });
      } catch {
        if (isCurrent()) setState({ scope: scope!, job: null, failed: true, loading: false });
      } finally {
        controller = null;
        if (isCurrent() && queued) { queued = false; void probe(); }
      }
    }
    const refresh = () => { void probe(); };
    refreshRef.current = refresh;
    refresh();
    const id = setInterval(refresh, PROBE_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("sneek:notification", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(id);
      refreshRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("sneek:notification", refresh);
    };
  }, [scope]);

  const current = scope && state?.scope === scope ? state : null;
  const job = current?.job ?? null;
  // Hiding the strip on a workspace must not interrupt the single GPS hook.
  useGpsTracker({ jobId: job?.id ?? "", enabled: Boolean(job && isTrackedStatus(job.status)) });

  if (!scope || !current || (!job && !current.failed)) return null;
  const href = job ? `/v2/cleaner/jobs/${encodeURIComponent(job.id)}` : null;
  if (href && (pathname === href || pathname?.startsWith(`${href}/`))) return null;
  const actionClass = "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded px-3 text-sm font-semibold hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
  return (
    <section aria-label="Active job" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2 text-[hsl(var(--e-foreground))] motion-reduce:animate-none">
      {current.failed ? <>
        <p role="status" className="min-w-0 flex-1 text-sm">Active job unavailable.</p>
        <button type="button" disabled={current.loading} onClick={() => refreshRef.current()} className={actionClass}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />Retry
        </button>
      </> : job && href ? <>
        <div className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
          <p className="text-sm font-semibold">{job.property.name}</p>
          <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{LABELS[job.status]}</p>
          {job.draftIdentity && job.clock && job.checkedAt ? <ActiveWorkStatus key={job.draftIdentity} identity={job.draftIdentity} jobId={job.id} clock={job.clock} checkedAt={job.checkedAt}/>
            : <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Clock and save status unavailable.</p>}
        </div>
        <Link href={href} className={actionClass}>Resume job<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
      </> : null}
    </section>
  );
}
