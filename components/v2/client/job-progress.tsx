"use client";

/**
 * Live mid-clean checklist progress ("Checklist progress ~N%"). Only mounted
 * when the showLiveProgress visibility setting is ON and the job is
 * IN_PROGRESS. Polls GET /api/client/jobs/[id] (which exposes progressPercent)
 * every 15s, mirroring JobLivePanel's cadence, and refreshes the page once the
 * job leaves IN_PROGRESS.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ECard, ECardBody } from "@/components/v2/ui/primitives";

const REFRESH_MS = 15_000;

export function JobProgressPanel({
  jobId,
  initialPercent,
}: {
  jobId: string;
  initialPercent: number | null;
}) {
  return <JobProgressReading key={jobId} jobId={jobId} initialPercent={initialPercent} />;
}

function JobProgressReading({ jobId, initialPercent }: { jobId: string; initialPercent: number | null }) {
  const router = useRouter();
  const [percent, setPercent] = useState<number | null>(Number.isFinite(initialPercent) ? initialPercent : null);
  const [failed, setFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      let continuePolling = true;
      try {
        const res = await fetch(`/api/client/jobs/${jobId}`, { cache: "no-store", signal: controller.signal, headers: { "x-progress-toast": "off" } });
        if (!res.ok) throw new Error("Unavailable");
        const data = await res.json();
        if (cancelled) return;
        if (data.id !== jobId || typeof data.status !== "string") throw new Error("Invalid response");
        if (data.status !== "IN_PROGRESS") {
          continuePolling = false;
          setPercent(null);
          router.refresh();
          return;
        }
        if (data.progressPercent !== null && (typeof data.progressPercent !== "number" || !Number.isFinite(data.progressPercent))) throw new Error("Invalid progress");
        setPercent(data.progressPercent);
        setCheckedAt(new Date());
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (continuePolling) timer = setTimeout(load, REFRESH_MS);
        }
      }
    }
    void load();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [jobId, router, attempt]);

  if (percent == null && !failed) return null;
  const clamped = Math.min(100, Math.max(0, Math.round(percent ?? 0)));

  return (
    <ECard variant="ceremony">
      <ECardBody className="space-y-2 pt-5">
        <div className="flex items-center justify-between gap-3 text-[0.875rem]">
          <span className="flex items-center gap-2 font-medium">
            <Sparkles className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
            Checklist progress
          </span>
          <span className="e-tnum font-semibold text-[hsl(var(--e-accent-portal))]">{percent == null ? "Unavailable" : `~${clamped}%`}</span>
        </div>
        {percent != null ? <div
          className="h-2 w-full overflow-hidden rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))]"
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Checklist progress"
        >
          <div
            className="h-full rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-accent-portal))] transition-[width] duration-500"
            style={{ width: `${clamped}%` }}
          />
        </div> : null}
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Estimated progress. This may use checklist updates or elapsed time.
        </p>
        {checkedAt ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Last checked {checkedAt.toLocaleTimeString("en-AU")}</p> : null}
        {failed ? <div role="status" className="space-y-2 text-sm">
          <p>Could not refresh progress.{percent != null ? " Showing the last available estimate." : ""}</p>
          <button type="button" disabled={loading} className="underline" onClick={() => setAttempt((value) => value + 1)}>{loading ? "Checking…" : "Retry progress"}</button>
        </div> : null}
      </ECardBody>
    </ECard>
  );
}
