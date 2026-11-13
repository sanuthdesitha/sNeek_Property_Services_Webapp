/**
 * Cards of the cleaner Today screen, in the board's order: clock state, next
 * job, offers, needs attention, my day. Presentational only — the server page
 * reads and scopes every value, and nothing here computes pay.
 *
 * No "use client": JobOfferActions is the only interactive child and is itself
 * a client component.
 */
import Link from "next/link";
import { ChevronRight, Clock, MapPin } from "lucide-react";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { JobStatusIcon } from "@/components/shared/job-status-icon";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { CleanerTimingSummary } from "@/components/v2/cleaner/timing-summary";
import type { ImmediateAttentionItem } from "@/components/shared/immediate-attention-panel";
import type { JobTimingBadges } from "@/lib/jobs/timing-badges";
import { formatAud, statusTone, titleCase, type TodayClockState } from "@/lib/cleaner/today-view";
import { EToneBand, toneMutedClass } from "@/components/v2/ui/tone-band";

/* ── Clock state ───────────────────────────────────────────────────────── */

export function ClockStateCard({ state }: { state: TodayClockState }) {
  if (state.kind === "clocked-in") {
    return (
      <ECard className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <EBadge tone="success" soft>Clocked in</EBadge>
        <p className="min-w-0 flex-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          {state.propertyName} since {state.since}.
        </p>
        <Link href={`/v2/cleaner/jobs/${state.jobId}`} className="inline-flex min-h-11 items-center gap-1 text-[0.8125rem] font-[600] underline-offset-2 hover:underline">
          Open job <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </ECard>
    );
  }
  if (state.kind === "unknown") {
    return (
      <ECard className="flex items-center gap-3 px-3 py-2.5">
        <EBadge tone="neutral" soft>Clock unknown</EBadge>
        <p className="min-w-0 flex-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          Your clock state could not be checked. Open your job to see it.
        </p>
      </ECard>
    );
  }
  return (
    <ECard className="flex items-center gap-3 px-3 py-2.5">
      <EBadge tone="neutral" soft>Not clocked in</EBadge>
      <p className="min-w-0 flex-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        You clock in on site at Set up. Route tracking starts when you tap Start driving.
      </p>
    </ECard>
  );
}

/* ── Next job ──────────────────────────────────────────────────────────── */

export interface TodayJobView {
  id: string;
  propertyName: string;
  address: string;
  window: string;
  /** "Thu 12 Nov" when the job is not today; null today. */
  otherDayLabel: string | null;
  jobTypeLabel: string;
  status: string;
  duration: string | null;
  pay: number | null;
  startTime: string | null;
  dueTime: string | null;
  sameDayCheckin: boolean;
  sameDayCheckinTime: string | null;
  timingBadges: JobTimingBadges | null;
  mapsHref: string | null;
}

export function NextJobCard({ job, routeHref }: { job: TodayJobView; routeHref: string | null }) {
  const navigateHref = routeHref ?? job.mapsHref;
  return (
    <section aria-labelledby="today-next-job" className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="e-eyebrow">Next job · {job.otherDayLabel ? `${job.otherDayLabel} · ` : ""}{job.window}</p>
        {job.pay != null ? <EBadge tone="gold" soft>{formatAud(job.pay)}</EBadge> : null}
      </div>
      <h2 id="today-next-job" className="e-serif text-[1.3rem] leading-tight [overflow-wrap:anywhere]">{job.propertyName}</h2>
      {job.address ? (
        <p className="flex items-start gap-1.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="break-words">{job.address}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <EBadge tone="neutral" soft>{job.jobTypeLabel}</EBadge>
        {job.duration ? <EBadge tone="neutral" soft>{job.duration}</EBadge> : null}
      </div>
      <CleanerTimingSummary
        showPlanned={false}
        startTime={job.startTime}
        dueTime={job.dueTime}
        timingBadges={job.timingBadges}
        sameDayCheckin={job.sameDayCheckin}
        sameDayCheckinTime={job.sameDayCheckinTime}
      />
      <div className="flex gap-2 pt-1">
        <EButton asChild variant="gold" className="min-h-11 flex-1">
          <Link href={`/v2/cleaner/jobs/${job.id}`}>
            Open job <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </EButton>
        {navigateHref ? (
          <EButton asChild variant="outline" className="min-h-11">
            {routeHref ? (
              <Link href={routeHref}>Navigate</Link>
            ) : (
              <a href={navigateHref} target="_blank" rel="noreferrer">Navigate</a>
            )}
          </EButton>
        ) : null}
      </div>
    </section>
  );
}

/* ── Offers ────────────────────────────────────────────────────────────── */

export function OfferCard({ job, dayLabel }: { job: TodayJobView; dayLabel: string }) {
  const facts = [job.jobTypeLabel, job.duration, job.pay != null ? formatAud(job.pay) : null].filter(Boolean).join(" · ");
  return (
    // An open offer flags its card: the title row is the attention band ("Offer:" states the reason).
    <ECard className="overflow-hidden">
      <EToneBand tone="attention" className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 py-2.5">
        <h3 className="text-[0.9375rem] font-[600] [overflow-wrap:anywhere]">
          <Link href={`/v2/cleaner/jobs/${job.id}`} className="underline-offset-2 hover:underline">Offer: {job.propertyName}</Link>
        </h3>
        <span className={`text-[0.75rem] ${toneMutedClass("attention")}`}>{dayLabel} · {job.startTime ?? "Time not set"}</span>
      </EToneBand>
      <div className="space-y-1.5 px-3 pb-2.5 pt-2">
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{facts}</p>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Access details appear once you accept.</p>
        <div className="pt-1">
          <JobOfferActions jobId={job.id} size="md" />
        </div>
      </div>
    </ECard>
  );
}

/* ── Needs attention ───────────────────────────────────────────────────── */

function attentionBadgeTone(tone: ImmediateAttentionItem["tone"]): "danger" | "warning" | "info" {
  if (tone === "critical") return "danger";
  if (tone === "warning") return "warning";
  return "info";
}

/** Rows of the existing attention feed, each linking to the screen that resolves it. */
export function AttentionList({ items }: { items: ImmediateAttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="today-attention" className="space-y-2">
      <h2 id="today-attention" className="e-eyebrow">Needs attention</h2>
      <ul className="divide-y divide-[hsl(var(--e-border))] overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        {items.map((item) => {
          const href = item.href ? item.href.replace(/^\/cleaner(?=\/|$)/, "/v2/cleaner") : null;
          const body = (
            <>
              <EBadge tone={attentionBadgeTone(item.tone)} soft>{item.count}</EBadge>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.875rem] font-[600]">{item.title}</span>
                <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.description}</span>
              </span>
              {href ? (
                <span className="inline-flex items-center gap-0.5 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
                  {item.actionLabel || "Open"} <ChevronRight className="h-4 w-4" aria-hidden />
                </span>
              ) : null}
            </>
          );
          return (
            <li key={item.id}>
              {href ? (
                <Link href={href} className="flex min-h-12 items-center gap-3 px-3 py-2.5 hover:bg-[hsl(var(--e-muted))]">{body}</Link>
              ) : (
                <div className="flex min-h-12 items-center gap-3 px-3 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── My day ────────────────────────────────────────────────────────────── */

export interface MyDayRow {
  id: string;
  time: string;
  propertyName: string;
  status: string;
  facts: string;
}

export function MyDayList({ rows }: { rows: MyDayRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ol className="space-y-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/v2/cleaner/jobs/${row.id}`}
            className="flex min-h-12 items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2.5 hover:bg-[hsl(var(--e-muted))]"
          >
            <span className="flex w-12 shrink-0 items-center gap-1 pt-0.5 text-[0.8125rem] font-[600] tabular-nums">
              <Clock className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
              {row.time}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.875rem] font-[600] [overflow-wrap:anywhere]">{row.propertyName}</span>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.facts}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <JobStatusIcon status={row.status} />
              <EBadge tone={statusTone(row.status)} soft>{titleCase(row.status)}</EBadge>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
