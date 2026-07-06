"use client";

/**
 * Estate live-arrival panel — native v2 port of the legacy EN_ROUTE tracking
 * card on the client job detail page. Polls the SAME endpoint the legacy page
 * used (GET /api/client/jobs/[id], every 15s) while the job is EN_ROUTE, and
 * renders the ETA, pause/delay state, schedule comparison, and live trip map.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { EBadge, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { ELiveTripMap } from "@/components/v2/client/live-trip-map";

type LiveJob = {
  id: string;
  status: string;
  startTime: string | null;
  enRouteEtaMinutes: number | null;
  enRouteEtaUpdatedAt: string | null;
  drivingPausedAt: string | null;
  drivingPauseReason: string | null;
  drivingDelayedAt: string | null;
  drivingDelayedReason: string | null;
  arrivedAt: string | null;
  liveTrip: {
    cleanerLat: number | null;
    cleanerLng: number | null;
    heading: number | null;
    lastPingAt: string | null;
    propertyLat: number | null;
    propertyLng: number | null;
  } | null;
  property: { latitude?: number | null; longitude?: number | null };
};

function formatFreshness(value: string | null | undefined) {
  if (!value) return "No live update yet";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function tripStateLabel(job: LiveJob) {
  if (job.arrivedAt) return "Arrived";
  if (job.drivingPausedAt) return "Paused";
  if (job.drivingDelayedAt) return "Delayed";
  return "On the way";
}

export function JobLivePanel({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<LiveJob | null>(null);
  const wasEnRoute = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function load(): Promise<LiveJob | null> {
      try {
        const res = await fetch(`/api/client/jobs/${jobId}`, {
          cache: "no-store",
          headers: { "x-progress-toast": "off" },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as LiveJob;
        if (!cancelled) setJob(data);
        return data;
      } catch {
        return null;
      }
    }

    load().then((data) => {
      if (!data || data.status !== "EN_ROUTE") return;
      wasEnRoute.current = true;
      intervalId = setInterval(async () => {
        const updated = await load();
        if (updated && updated.status !== "EN_ROUTE" && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
          // The rest of the page is server-rendered — refresh it so the status
          // badge and timeline catch up once the cleaner arrives.
          router.refresh();
        }
      }, 15000);
    });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [jobId, router]);

  if (!job || job.status !== "EN_ROUTE") return null;

  // Compare predicted arrival vs scheduled start time (mirrors legacy logic).
  const scheduleStatus: "early" | "late" | "on-time" | null = (() => {
    if (!job.startTime || job.enRouteEtaMinutes == null || job.drivingPausedAt) return null;
    const [h, m] = job.startTime.split(":").map(Number);
    const scheduledMinutes = h * 60 + m;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const diff = nowMinutes + job.enRouteEtaMinutes - scheduledMinutes;
    if (diff > 10) return "late";
    if (diff < -10) return "early";
    return "on-time";
  })();

  const etaLabel =
    job.enRouteEtaMinutes != null
      ? job.enRouteEtaMinutes <= 1
        ? "Arriving now"
        : (() => {
            const arrival = new Date(Date.now() + job.enRouteEtaMinutes * 60 * 1000);
            const time = arrival.toLocaleTimeString("en-AU", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
            return `${job.enRouteEtaMinutes} min · ~${time}`;
          })()
      : "Waiting for ETA";

  return (
    <ECard variant="ceremony">
      <ECardHeader>
        <ECardTitle className="flex flex-wrap items-center gap-2 text-[1rem]">
          <MapPin className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
          {job.drivingPausedAt
            ? "Cleaner has paused driving"
            : job.arrivedAt
              ? "Cleaner has arrived"
              : "Cleaner is on the way"}
          <EBadge tone={job.drivingPausedAt ? "danger" : job.drivingDelayedAt ? "warning" : "primary"} soft>
            {tripStateLabel(job)}
          </EBadge>
          {scheduleStatus === "late" ? (
            <EBadge tone="danger" soft>
              Running late
            </EBadge>
          ) : null}
          {scheduleStatus === "early" ? (
            <EBadge tone="success" soft>
              Arriving early
            </EBadge>
          ) : null}
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3">
        {job.drivingPausedAt ? (
          <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.875rem] font-medium">
            Your cleaner has temporarily paused driving
            {job.drivingPauseReason
              ? ` · ${job.drivingPauseReason.replace(/_/g, " ").toLowerCase()}`
              : ""}
            . ETA will resume once they continue.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-[0.875rem]">
            <span className="font-medium">{etaLabel}</span>
            {scheduleStatus === "late" && job.startTime ? (
              <span className="text-[0.75rem] font-medium text-[hsl(var(--e-danger))]">
                Behind schedule (starts {job.startTime})
              </span>
            ) : null}
            {scheduleStatus === "early" && job.startTime ? (
              <span className="text-[0.75rem] font-medium text-[hsl(var(--e-success))]">
                Arriving before {job.startTime}
              </span>
            ) : null}
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Updated {formatFreshness(job.enRouteEtaUpdatedAt ?? job.liveTrip?.lastPingAt ?? null)}
            </span>
          </div>
        )}
        {job.drivingDelayedAt && !job.drivingPausedAt ? (
          <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.875rem]">
            Delay reported
            {job.drivingDelayedReason
              ? `: ${job.drivingDelayedReason.replace(/_/g, " ").toLowerCase()}`
              : ""}
          </div>
        ) : null}
        <ELiveTripMap
          cleanerLat={job.liveTrip?.cleanerLat ?? null}
          cleanerLng={job.liveTrip?.cleanerLng ?? null}
          propertyLat={job.liveTrip?.propertyLat ?? job.property?.latitude ?? null}
          propertyLng={job.liveTrip?.propertyLng ?? job.property?.longitude ?? null}
          heading={job.liveTrip?.heading ?? null}
          className="h-64"
        />
      </ECardBody>
    </ECard>
  );
}
