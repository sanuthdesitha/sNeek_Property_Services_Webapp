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
  const router = useRouter();
  const [percent, setPercent] = useState<number | null>(initialPercent);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/client/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.status !== "IN_PROGRESS") {
          window.clearInterval(timer);
          router.refresh();
          return;
        }
        setPercent(typeof data.progressPercent === "number" ? data.progressPercent : null);
      } catch {
        // transient — keep the last reading
      }
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, router]);

  if (percent == null) return null;
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));

  return (
    <ECard variant="ceremony">
      <ECardBody className="space-y-2 pt-5">
        <div className="flex items-center justify-between gap-3 text-[0.875rem]">
          <span className="flex items-center gap-2 font-medium">
            <Sparkles className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
            Checklist progress
          </span>
          <span className="e-tnum font-semibold text-[hsl(var(--e-accent-portal))]">~{clamped}%</span>
        </div>
        <div
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
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Live from your cleaner's checklist — updates as they work.
        </p>
      </ECardBody>
    </ECard>
  );
}
