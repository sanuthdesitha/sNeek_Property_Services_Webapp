"use client";

/**
 * Below the fold: what the old Command page showed besides its attention list.
 * Today by status (each a link into Jobs filtered by that status for today),
 * on shift now (opens Live ops), today's dispatch (the Jobs "Today" view, the
 * same rows uncapped), upcoming six days, recent client feedback, laundry due
 * today, cleaners scheduled tomorrow and completed today.
 */
import Link from "next/link";
import { Star } from "lucide-react";
import { EPill } from "@/components/v2/ui/pill";
import type { GlancePayload } from "@/lib/dashboard/command-types";
import { JOBS_TODAY_HREF, LAUNDRY_HREF, LIVE_OPS_HREF } from "@/lib/dashboard/work-queue-links";
import { SectionBody } from "./section-state";
import { useCommandSection } from "./use-command-section";

const CARD = "min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4";
const UNAVAILABLE = <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Could not be read just now.</p>;

function figure(value: number | null): string {
  return value === null ? "—" : String(value);
}

function TodayCard({ data }: { data: GlancePayload }) {
  return (
    <section aria-labelledby="glance-today" className={`${CARD} lg:col-span-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="glance-today" className="text-[0.8125rem] font-[600]">Today by status</h2>
        <Link href={JOBS_TODAY_HREF} className="text-[0.8125rem]">Today&apos;s dispatch in Jobs</Link>
      </div>
      {data.statuses ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Jobs today by status">
          {data.statuses.map((entry) => (
            <li key={entry.status}>
              <Link href={entry.href} className={`inline-flex items-center gap-2 rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))] ${entry.count > 0 ? "border-[hsl(var(--e-border-strong))]" : "border-[hsl(var(--e-border))] text-[hsl(var(--e-text-faint))]"}`}>
                <span className="e-tnum font-[600]">{entry.count}</span>{entry.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : UNAVAILABLE}
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[0.8125rem] sm:grid-cols-4">
        <div><dt className="text-[hsl(var(--e-muted-foreground))]">On the way</dt><dd className="e-numeral text-[1.25rem]">{figure(data.onShift?.travelling ?? null)}</dd></div>
        <div><dt className="text-[hsl(var(--e-muted-foreground))]">On site</dt><dd className="e-numeral text-[1.25rem]">{figure(data.onShift?.onSite ?? null)}</dd></div>
        <div><dt className="text-[hsl(var(--e-muted-foreground))]">Clocked in</dt><dd className="e-numeral text-[1.25rem]">{figure(data.onShift?.clockedIn ?? null)}</dd></div>
        <div><dt className="text-[hsl(var(--e-muted-foreground))]">Completed today</dt><dd className="e-numeral text-[1.25rem]">{figure(data.completedToday)}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
        <Link href={LIVE_OPS_HREF}>Open Live ops</Link>
        <Link href={LAUNDRY_HREF}>Laundry due today: <span className="e-tnum">{figure(data.laundryDueToday)}</span></Link>
      </div>
    </section>
  );
}

function UpcomingCard({ data }: { data: GlancePayload }) {
  return (
    <section aria-labelledby="glance-upcoming" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="glance-upcoming" className="text-[0.8125rem] font-[600]">Upcoming</h2>
        {data.cleanersTomorrow !== null ? <EPill>{data.cleanersTomorrow} cleaners tomorrow</EPill> : null}
      </div>
      {data.upcoming === null ? UNAVAILABLE : data.upcoming.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No jobs in the next six days.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.upcoming.map((job) => (
            <li key={job.id}>
              <Link href={`/v2/admin/jobs/${job.id}`} className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2 text-inherit hover:bg-[hsl(var(--e-muted))]">
                <span className="min-w-0">
                  <span className="block truncate text-[0.8125rem] font-[550]">{job.propertyName}</span>
                  <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{job.when} · {job.jobType}</span>
                </span>
                <EPill>{job.statusLabel}</EPill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedbackCard({ data }: { data: GlancePayload }) {
  return (
    <section aria-labelledby="glance-feedback" className={CARD}>
      <h2 id="glance-feedback" className="text-[0.8125rem] font-[600]">Recent feedback</h2>
      {data.feedback === null ? UNAVAILABLE : data.feedback.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No client ratings in the last week.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.feedback.map((fb) => (
            <li key={fb.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/v2/admin/jobs/${fb.jobId}`} className="truncate text-[0.8125rem] font-[550] text-inherit hover:underline">{fb.clientName}</Link>
                {fb.rating != null ? (
                  <span className="inline-flex items-center gap-0.5 text-[hsl(var(--e-gold-ink))]"><Star aria-hidden className="h-3.5 w-3.5 fill-current" /><span className="e-tnum text-[0.8125rem]">{fb.rating.toFixed(1)}<span className="sr-only"> out of 5</span></span></span>
                ) : null}
              </div>
              {fb.comment ? <p className="mt-1 line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">&ldquo;{fb.comment}&rdquo;</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CommandGlance({ initial, timeZone }: { initial: GlancePayload | null; timeZone: string }) {
  const state = useCommandSection<GlancePayload>("glance", initial);
  return (
    <div className="min-w-0">
      <SectionBody state={state} label="Today at a glance" timeZone={timeZone} rows={3}>
        {(data) => (
          <div className="grid min-w-0 grid-cols-1 gap-3.5 lg:grid-cols-4">
            <TodayCard data={data} />
            <UpcomingCard data={data} />
            <FeedbackCard data={data} />
          </div>
        )}
      </SectionBody>
    </div>
  );
}
