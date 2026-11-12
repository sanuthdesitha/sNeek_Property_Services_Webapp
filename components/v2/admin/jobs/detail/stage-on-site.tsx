/**
 * 4 · On site — clock records per cleaner, the job's clock-in location
 * against the property's on-site radius, continuation requests (moved from
 * the Schedule tab) and time over the allocation. Editing clock and GPS
 * stays in the Clock and GPS tab.
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { DEFAULT_GEOFENCE_RADIUS_M } from "@/lib/gps/distance";
import { jobPageViewHref } from "@/lib/jobs/job-page/deep-link";
import { formatMinutes, siteMinutes } from "@/lib/jobs/job-page/facts";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { JobContinuationReviews } from "../job-detail-reviews";
import type { JobPageData } from "./job-page-data";
import { Muted, StageSection, StageShell } from "./stage-shell";

function GpsBadge({ data }: { data: JobPageData }) {
  const distance = data.job.gpsDistanceMeters;
  if (distance == null) return <Muted>Clock-in location not recorded</Muted>;
  const radius = data.job.property?.geofenceRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M;
  const inside = distance <= radius;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <EBadge tone={inside ? "success" : "warning"} soft>
        {inside ? `Clocked in ${Math.round(distance)} m from the pin` : `Started away from the property, ${Math.round(distance)} m`}
      </EBadge>
      {data.job.gpsCheckInAdjusted ? <EBadge tone="info" soft>Adjusted by the office</EBadge> : null}
      <Link href={jobPageViewHref(data.job.id, "clock")} className="inline-flex min-h-11 items-center text-[hsl(var(--e-accent-portal))] hover:underline">Map</Link>
    </span>
  );
}

export function StageOnSite({ data, stage, collapsed, now }: { data: JobPageData; stage: TimelineStage; collapsed: boolean; now: Date }) {
  const { job } = data;
  const time = (date: Date) => formatInTimeZone(date, data.timeZone, "HH:mm");
  const site = siteMinutes(job.timeLogs, now);
  const allocatedMinutes = job.estimatedHours != null ? job.estimatedHours * 60 : null;
  const over = site && allocatedMinutes != null && site.minutes > allocatedMinutes ? site.minutes - allocatedMinutes : null;
  const pending = data.pendingContinuationCount;
  const actions = (
    <EButton asChild size="sm" variant="ghost"><Link href={jobPageViewHref(job.id, "clock")}>Edit clock and GPS</Link></EButton>
  );
  return (
    <StageShell stage={stage} actions={job.timeLogs.length > 0 ? actions : undefined} collapsed={collapsed}>
      {job.timeLogs.length === 0 ? (
        <Muted>No clock records yet.</Muted>
      ) : (
        <div className="min-w-0 overflow-x-auto" role="region" aria-label="Clock records" tabIndex={0}>
          <table className="w-full min-w-[28rem] text-left text-[0.8125rem]">
            <thead className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <tr><th className="py-1.5 pr-3 font-[550]">Cleaner</th><th className="py-1.5 pr-3 font-[550]">Clock-in</th><th className="py-1.5 pr-3 font-[550]">Clock-out</th><th className="py-1.5 text-right font-[550]">Duration</th></tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--e-border))]">
              {job.timeLogs.map((log) => (
                <tr key={log.id}>
                  <td className="py-1.5 pr-3">{log.user?.name ?? log.user?.email ?? "Cleaner"}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{time(log.startedAt)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{log.stoppedAt ? time(log.stoppedAt) : <EBadge tone="info" soft>Running</EBadge>}</td>
                  <td className="py-1.5 text-right tabular-nums">{log.durationM != null ? formatMinutes(log.durationM) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Muted>Location at clock-in:</Muted> <GpsBadge data={data} />
      </div>
      {data.continuationRows.length > 0 ? (
        <StageSection title="Continuation requests" aside={pending > 0 ? <EBadge tone="warning" soft>{pending} pending</EBadge> : null}>
          <JobContinuationReviews requests={data.continuationRows} />
        </StageSection>
      ) : null}
      <Muted>
        {data.continuationRows.length === 0 ? "No continuation requests. " : ""}
        {over != null ? `Over allocated time by ${formatMinutes(over)}: pay settles from clocked time at payroll.` : ""}
      </Muted>
    </StageShell>
  );
}
