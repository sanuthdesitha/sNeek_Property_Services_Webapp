/**
 * Client Home on a phone (board 1): happening now, approvals waiting, upcoming
 * cleans, last report, what needs you, and Book a clean. Server-renderable;
 * every section shows loading failures as "unavailable", never as empty.
 */
import Link from "next/link";
import { EBadge, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EstateReportDownloadButton } from "@/components/v2/client/report-download-button";
import type { ClientHomeData } from "@/lib/client/home-dashboard";
import { formatAud } from "@/components/v2/client/money/money-format";
import {
  cleanerNames, happeningNow, liveLabel, sentence, sydneyFormat, upcomingBadge, upcomingJobs,
  type HomeJob,
} from "@/components/v2/client/home/home-model";
import { EToneBand, toneMutedClass, toneNoticeClass, type ETone } from "@/components/v2/ui/tone-band";

function Unavailable({ section }: { section: string }) {
  return <p className="py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{section} unavailable.</p>;
}

export function HappeningNowCard({ job, showNames }: { job: HomeJob; showNames: boolean }) {
  const names = showNames ? cleanerNames(job) : null;
  const detail = [
    names,
    job.startTime ? `planned ${job.startTime}` : null,
    job.dueTime ? `finish about ${job.dueTime}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <Link href={`/v2/client/jobs/${job.id}`} className="block rounded-[var(--e-radius-lg)] focus-visible:outline focus-visible:outline-2">
      <ECard className="border-[hsl(var(--e-info)/0.45)] p-3">
        <div className="flex items-center justify-between gap-2">
          <EEyebrow className="text-[hsl(var(--e-info))]">Happening now</EEyebrow>
          <EBadge tone="info" soft>{liveLabel(job.status)}</EBadge>
        </div>
        <p className="e-serif mt-1 text-[1.1875rem]">{job.property.name}</p>
        {detail ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{detail}</p> : null}
      </ECard>
    </Link>
  );
}

function DecisionsCard({ data }: { data: ClientHomeData }) {
  if (!data.showDecisions) return null;
  if (data.decisions === null || data.quotes === null) return <ECard className="p-3"><Unavailable section="Approvals" /></ECard>;
  const quotes = data.quotes;
  const count = data.decisions.count + quotes.length;
  if (count === 0) return null;
  const total = data.decisions.totalAud === null ? null : data.decisions.totalAud + quotes.reduce((sum, quote) => sum + quote.totalAmount, 0);
  const titles = [...data.decisions.titles, ...quotes.map((quote) => `Quote for ${sentence(quote.serviceType).toLowerCase()}`)].slice(0, 3);
  return (
    <ECard className="overflow-hidden">
      <EToneBand tone="attention" className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-[0.9375rem] font-semibold">{count} {count === 1 ? "approval" : "approvals"} waiting</span>
        {total !== null ? <span className={`e-numeral text-[0.8125rem] ${toneMutedClass("attention")}`}>{formatAud(total)}</span> : null}
      </EToneBand>
      <div className="p-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{titles.join(" · ")}</p>
        <Link href="/v2/client/approvals" className="mt-2 flex min-h-11 w-full items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[0.875rem] font-[550] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2">
          Review approvals
        </Link>
      </div>
    </ECard>
  );
}

function UpcomingCard({ data, todayKey }: { data: ClientHomeData; todayKey: string }) {
  const showNames = data.visibility.showCleanerNames === true;
  if (data.jobs === null) return <ECard className="px-3"><Unavailable section="Upcoming cleans" /></ECard>;
  const rows = upcomingJobs(data.jobs as HomeJob[], todayKey).slice(0, 3);
  if (rows.length === 0) {
    return (
      <ECard className="p-3">
        <p className="text-[0.875rem] font-[550]">No upcoming cleans</p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing is currently scheduled for your properties.</p>
      </ECard>
    );
  }
  return (
    <ECard className="overflow-hidden">
      <ul className="divide-y divide-[hsl(var(--e-border))]">
        {rows.map((job) => {
          const badge = upcomingBadge(job.status);
          const names = showNames ? cleanerNames(job) : null;
          return (
            <li key={job.id}>
              <Link href={`/v2/client/jobs/${job.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2.5 hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2">
                <span className="w-11 shrink-0 text-[0.75rem] font-semibold leading-tight text-[hsl(var(--e-text-secondary))] e-tnum">
                  {sydneyFormat(job.scheduledDate, "EEE")}<br />{sydneyFormat(job.scheduledDate, "d")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-semibold">{job.property.name}</span>
                  <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {[job.startTime, sentence(job.jobType), names].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <EBadge tone={badge.tone} soft>{badge.label}</EBadge>
              </Link>
            </li>
          );
        })}
      </ul>
    </ECard>
  );
}

function LastReportCard({ data }: { data: ClientHomeData }) {
  if (!data.visibility.showReports) return null;
  if (data.reports === null) return <ECard className="px-3"><Unavailable section="Reports" /></ECard>;
  const report = data.reports[0];
  if (!report) {
    return (
      <ECard className="p-3">
        <p className="text-[0.875rem] font-[550]">No reports available</p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Reports appear here once a clean is completed.</p>
      </ECard>
    );
  }
  return (
    <ECard className="p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[0.875rem] font-semibold">Last report · {report.job.property.name}</span>
        <span className="shrink-0 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{sydneyFormat(report.job.scheduledDate, "EEE d MMM")}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={`/v2/client/jobs/${report.job.id}#job-report`} className="inline-flex min-h-11 items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))]">
          Open report
        </Link>
        {data.visibility.showReportDownloads ? <EstateReportDownloadButton jobId={report.job.id} label="PDF" /> : null}
        <Link href="/v2/client/reports" className="inline-flex min-h-11 items-center px-2 text-[0.8125rem] underline">All reports</Link>
      </div>
    </ECard>
  );
}

const TONE: Record<string, ETone> = { critical: "problem", warning: "attention", info: "info" };

export function NeedsYou({ data }: { data: ClientHomeData }) {
  if (data.attention === null) return <ECard className="px-3"><Unavailable section="Attention" /></ECard>;
  const items = data.attention.filter((item) => item.tone !== "info");
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="home-needs-you" className="space-y-2">
      <h2 id="home-needs-you" className="e-eyebrow">Needs you</h2>
      {items.map((item) => {
        const href = item.href ? item.href.replace(/^\/client/, "/v2/client") : null;
        const tone = TONE[item.tone ?? "info"] ?? TONE.info;
        return (
          <div key={item.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] px-3 py-2 ${toneNoticeClass(tone)}`}>
            <div className="min-w-0">
              <p className="text-[0.875rem] font-medium">{item.title} <span className="e-numeral">{item.count}</span></p>
              <p className={`text-[0.75rem] ${toneMutedClass(tone)}`}>{item.description}</p>
            </div>
            {href ? <Link href={href} className="inline-flex min-h-11 items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] font-[550]">{item.actionLabel ?? "Open"}</Link> : null}
          </div>
        );
      })}
    </section>
  );
}

export function PhoneHome({ data, todayKey }: { data: ClientHomeData; todayKey: string }) {
  const live = data.jobs ? happeningNow(data.jobs as HomeJob[], todayKey) : null;
  return (
    <div className="space-y-3">
      {live ? <HappeningNowCard job={live} showNames={data.visibility.showCleanerNames === true} /> : null}
      <DecisionsCard data={data} />
      <h2 className="e-eyebrow pt-1">Upcoming cleans</h2>
      <UpcomingCard data={data} todayKey={todayKey} />
      <LastReportCard data={data} />
      <NeedsYou data={data} />
      {data.visibility.showBooking ? (
        <div className="sticky bottom-[4.75rem] z-20 -mx-4 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2.5">
          <Link href="/v2/client/booking" className="flex min-h-12 w-full items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-accent-portal))] text-[0.9375rem] font-[600] text-[hsl(var(--e-accent-portal-foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            Book a clean
          </Link>
        </div>
      ) : null}
    </div>
  );
}
