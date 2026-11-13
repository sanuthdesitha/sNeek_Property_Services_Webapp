"use client";

/**
 * On site, Travelling and Not started lists, and the on-site progress rows
 * (time elapsed against the job's allocated time; checklist progress from the
 * cleaner's live draft, or elapsed time when there is no checklist data — the
 * row says which). Laundry drivers show their active route's stops.
 */
import Link from "next/link";
import { EPill } from "@/components/v2/ui/pill";
import type { LiveDriverRow, LiveJobRow } from "@/lib/ops/live-board-types";

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function names(job: LiveJobRow): string {
  return job.cleaners.map((c) => c.name).join(", ") || "No cleaner";
}

function Bar({ percent, gold = false, label }: { percent: number; gold?: boolean; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-surface-sunken,var(--e-surface-raised)))]">
      <i className="block h-full rounded-full" style={{ width: `${percent}%`, background: gold ? "hsl(var(--e-gold))" : "hsl(var(--e-primary))" }} />
    </div>
  );
}

function SelectName({ job, onSelect }: { job: LiveJobRow; onSelect: (userId: string) => void }) {
  const first = job.cleaners[0];
  const text = `${names(job)} · ${job.propertyName}`;
  return first ? (
    <button type="button" onClick={() => onSelect(first.id)} className="min-w-0 truncate text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">{text}</button>
  ) : <span className="min-w-0 truncate">{text}</span>;
}

export function OnSiteRows({ jobs, drivers, onSelect }: { jobs: LiveJobRow[]; drivers: LiveDriverRow[]; onSelect: (userId: string) => void }) {
  if (jobs.length === 0 && drivers.length === 0) return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nobody is on site right now.</p>;
  return (
    <ul className="space-y-2" aria-label="On site progress">
      {jobs.map((job) => {
        const time = job.elapsedMinutes != null
          ? `${duration(job.elapsedMinutes)}${job.allocatedMinutes ? ` of ${duration(job.allocatedMinutes)}` : ", no allocated time"}`
          : "Arrival time not recorded";
        const progress = job.progress
          ? job.progress.basis === "checklist" ? `${job.progress.percent}% of checklist` : `${job.progress.percent}% of allocated time`
          : null;
        return (
          <li key={job.jobId} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-[0.8125rem]">
              <SelectName job={job} onSelect={onSelect} />
              <span className="e-tnum shrink-0 text-[hsl(var(--e-muted-foreground))]">{time}{progress ? ` · ${progress}` : ""}</span>
            </div>
            {job.progress ? <Bar percent={job.progress.percent} label={`${job.propertyName}: ${progress}`} /> : null}
            {job.status === "PAUSED" ? <EPill tone="gold">Paused</EPill> : null}
            {job.cleanerStates?.some((cleaner) => cleaner.startedWithoutFix) ? <EPill tone="neutral">Started without a location fix</EPill> : null}
          </li>
        );
      })}
      {drivers.map((driver) => {
        const percent = driver.stopsTotal > 0 ? Math.round((driver.stopsDone / driver.stopsTotal) * 100) : 0;
        const label = driver.stopsTotal > 0 ? `Stop ${Math.min(driver.stopsDone + 1, driver.stopsTotal)} of ${driver.stopsTotal}` : "No stops on the route";
        return (
          <li key={driver.routeId} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-[0.8125rem]">
              <button type="button" onClick={() => onSelect(driver.userId)} className="min-w-0 truncate text-left hover:underline">{driver.name} · laundry route</button>
              <span className="e-tnum shrink-0 text-[hsl(var(--e-muted-foreground))]">{label}</span>
            </div>
            <Bar percent={percent} gold label={`${driver.name}: ${driver.stopsDone} of ${driver.stopsTotal} stops done`} />
          </li>
        );
      })}
    </ul>
  );
}

export function SimpleJobList({ jobs, empty, onSelect }: { jobs: LiveJobRow[]; empty: string; onSelect: (userId: string) => void }) {
  if (jobs.length === 0) return <p className="px-4 py-8 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{empty}</p>;
  return (
    <ul>
      {jobs.map((job) => (
        <li key={job.jobId} className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3 text-[0.8125rem]">
          <SelectName job={job} onSelect={onSelect} />
          <span className="flex items-center gap-2 text-[hsl(var(--e-muted-foreground))]">
            {job.startTime ? <span className="e-tnum">Start {job.startTime}</span> : <span>No start time</span>}
            {job.etaClock ? <span className="e-tnum">· ETA {job.etaClock}</span> : null}
            {job.state === "not-started" ? <EPill tone="warn">{job.minutes} min past start</EPill> : null}
            <Link href={`/v2/admin/jobs/${job.jobId}`} className="text-[hsl(var(--e-primary))]">Open</Link>
          </span>
        </li>
      ))}
    </ul>
  );
}
