import Link from "next/link";
import { sydneyTodayKey, addDaysToKey } from "@/lib/time/sydney-range";
import { isCleanerShiftOffer, SHIFT_ROUTE_STATUSES } from "@/lib/cleaner/shift";
import { ShiftRouteOverview } from "@/components/v2/cleaner/shift-route-overview";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
  EEmptyState,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Coins, MapPin, Timer } from "lucide-react";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { DailyBriefing } from "@/components/v2/cleaner/daily-briefing";
import { CleanerCoachingCard } from "@/components/v2/cleaner/coaching-card";
import { CleanerQaFeedbackCard } from "@/components/v2/cleaner/qa-feedback-card";
import { getCleanerImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { autoClockOutStaleTimeLogsForUser } from "@/lib/time/auto-clockout";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { resolveTimingBadges } from "@/lib/jobs/timing-badges";
import { CleanerTimingSummary } from "@/components/v2/cleaner/timing-summary";
import { computeJobPayForCleaner } from "@/lib/finance/job-pay-for-cleaner";

export const metadata = { title: "Today · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: string): Tone {
  switch (status) {
    case "UNASSIGNED":
    case "OFFERED":
      return "warning";
    case "ASSIGNED":
    case "EN_ROUTE":
      return "primary";
    case "IN_PROGRESS":
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
      return "info";
    case "SUBMITTED":
      return "warning";
    case "QA_REVIEW":
      return "aubergine";
    case "COMPLETED":
    case "INVOICED":
      return "success";
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isSameLocalDay(date: Date, now: Date) {
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

/** Full, never-truncated address line: "address, suburb STATE postcode". */
function fullAddress(p: { address: string | null; suburb: string | null; state: string | null; postcode: string | null }): string {
  const locality = [p.suburb, p.state, p.postcode].filter(Boolean).join(" ");
  return [p.address, locality].filter(Boolean).join(", ");
}

/** Expected on-site duration — minutes preferred, hours as a fallback. */
function durationLabel(minutes: number | null | undefined, hours: number | null | undefined): string | null {
  if (minutes && minutes > 0) {
    if (minutes < 60) return `~${minutes} min`;
    const h = minutes / 60;
    return `~${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  if (hours && hours > 0) return `~${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  return null;
}

/**
 * This cleaner's active jobs for the next 7 days — mirrors the live cleaner
 * dashboard query (assignments scoped to the session user, removedAt null,
 * open statuses only). Scoped so a cleaner never sees another cleaner's work.
 */
async function getCleanerWeekJobs(userId: string, todayStart: Date, nextWeek: Date) {
  return db.job
    .findMany({
      where: {
        assignments: { some: { userId, removedAt: null } },
        OR: [
          { scheduledDate: { gte: todayStart, lt: nextWeek } },
          { status: { in: ["UNASSIGNED", "OFFERED", "ASSIGNED"] }, assignments: { some: { userId, removedAt: null, responseStatus: "PENDING" } } },
        ],
        cleanSkipStatus: { not: "SKIPPED" },
        status: { notIn: ["COMPLETED", "INVOICED"] },
      },
      select: {
        id: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        sameDayCheckin: true,
        sameDayCheckinTime: true,
        estimatedHours: true,
        isRework: true,
        reworkPayAmount: true,
        internalNotes: true,
        assignments: {
          where: { removedAt: null },
          select: { userId: true, payRate: true, responseStatus: true },
        },
        property: {
          select: {
            name: true,
            address: true,
            suburb: true,
            state: true,
            postcode: true,
            cleaningDurationMinutes: true,
          },
        },
      },
      orderBy: [
        { scheduledDate: "asc" },
        { priorityBucket: "asc" },
        { dueTime: "asc" },
        { startTime: "asc" },
      ],
    })
    .catch(() => null);
}

export default async function CleanerTodayPage() {
  const session = await requireRole([Role.CLEANER]);
  // Same safety net as the v1 dashboard: close out any clock left running
  // overnight before computing today's numbers.
  await autoClockOutStaleTimeLogsForUser(session.user.id).catch(() => {});
  const cleanerName =
    session.user.name?.trim()?.split(" ")[0] ||
    session.user.email?.split("@")[0] ||
    "there";

  const now = toZonedTime(new Date(), TZ);
  const dayKey = sydneyTodayKey();
  const todayStart = new Date(`${dayKey}T00:00:00.000Z`);
  const nextWeek = new Date(`${addDaysToKey(dayKey, 7)}T00:00:00.000Z`);

  const [jobsResult, attentionResult, settings, cleanerUser] = await Promise.all([
    getCleanerWeekJobs(session.user.id, todayStart, nextWeek),
    getCleanerImmediateAttention(session.user.id).catch(() => null),
    getAppSettings().catch(() => null),
    db.user
      .findUnique({ where: { id: session.user.id }, select: { hourlyRate: true } })
      .catch(() => null),
  ]);

  const jobs = jobsResult ?? [];
  const urgentItems = attentionResult ?? [];
  const isOffer = (job: (typeof jobs)[number]) => isCleanerShiftOffer(job, session.user.id);

  // Per-job pay for THIS cleaner (same canonical math as the job screen/briefing).
  const fmtAud = (n: number) =>
    `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const payByJob = new Map<string, number>();
  if (settings) {
    for (const j of jobs) {
      const meta = parseJobInternalNotes((j as any).internalNotes ?? null);
      const pay = computeJobPayForCleaner({
        cleanerId: session.user.id,
        job: {
          jobType: j.jobType,
          estimatedHours: j.estimatedHours,
          isRework: (j as any).isRework,
          reworkPayAmount: (j as any).reworkPayAmount,
        },
        assignments: ((j as any).assignments ?? []).map((a: any) => ({
          userId: a.userId,
          payRate: a.payRate ?? null,
        })),
        userHourlyRate: cleanerUser?.hourlyRate ?? null,
        cleanerJobHourlyRates: settings.cleanerJobHourlyRates,
        cleanerPayouts: meta.cleanerPayouts,
        transportAllowances: meta.transportAllowances,
      });
      if (pay != null) payByJob.set(j.id, pay);
    }
  }

  const visibleUrgent = urgentItems.filter((item) => Number(item.count) > 0);
  const offeredJobs = jobs.filter(isOffer);
  const todayJobs = jobs.filter((j) => !isOffer(j) && j.scheduledDate.toISOString().slice(0, 10) === dayKey);
  const nextJob = jobs.find(j => !isOffer(j) && SHIFT_ROUTE_STATUSES.includes(j.status) && j.scheduledDate >= todayStart) ?? null;

  // "My day" = everything that wants your attention today: today's scheduled
  // jobs plus any outstanding offers (which may be for a future day). `jobs` is
  // already ordered by date → priority → time, so the timeline stays in order.
  const myDay = jobs.filter(
    (j) => isOffer(j) || isSameLocalDay(toZonedTime(j.scheduledDate, TZ), now)
  );

  const dateLine = format(now, "EEEE · d MMMM").toUpperCase();
  const greeting = now.getHours() < 12 ? "Morning" : now.getHours() < 17 ? "Afternoon" : "Evening";
  const jobCount = todayJobs.length;

  return (
    <div className="space-y-6">
      <header className="e-rise">
        <EEyebrow>{dateLine}</EEyebrow>
        <h1 className="e-display-md mt-1">
          {greeting}, {cleanerName}.
        </h1>
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          {jobsResult === null ? "Your shift could not be loaded." : jobCount === 0
            ? "No accepted jobs scheduled today."
            : `${jobCount} accepted job${jobCount === 1 ? "" : "s"} today.`}
        </p>
      </header>

      {/* Today's brief comes FIRST. It is the orientation — weather, what the
          day looks like, anything the office wants said before work starts —
          and reading it after the job list is reading it too late to change
          how the day is planned. */}
      <DailyBriefing />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>Shift snapshot from this page load. {jobsResult !== null ? `${offeredJobs.length} pending offer${offeredJobs.length === 1 ? "" : "s"}.` : ""}</p>
        <a href="/v2/cleaner" className="inline-flex min-h-11 items-center underline">Refresh shift</a>
      </div>
      {jobsResult === null || attentionResult === null ? <div role="alert" className="border-l-4 border-red-600 p-3 text-sm">{jobsResult === null ? "Jobs and route are unavailable. " : ""}{attentionResult === null ? "Attention items are unavailable. " : ""}Refresh this page to try again.</div> : null}
      {jobsResult !== null ? <ShiftRouteOverview userId={session.user.id} day={dayKey} stops={todayJobs.filter(job => SHIFT_ROUTE_STATUSES.includes(job.status)).map(job => ({ jobId: job.id, property: job.property.name, address: fullAddress(job.property), startTime: job.startTime, status: job.status }))} /> : null}


      {/* My day — one vertical timeline of today's jobs + outstanding offers */}
      {jobsResult === null ? null : myDay.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow">MY DAY</span>
          {myDay.map((j) => {
            const isOffered = isOffer(j);
            const isToday = isSameLocalDay(toZonedTime(j.scheduledDate, TZ), now);
            const timeWindow = j.startTime
              ? j.dueTime
                ? `${j.startTime}–${j.dueTime}`
                : j.startTime
              : "Time TBC";
            const address = fullAddress(j.property);
            const duration = durationLabel(j.property.cleaningDurationMinutes, j.estimatedHours);
            const mapsHref = address
              ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
              : null;
            return (
              <ECard key={j.id} variant={isOffered ? "ceremony" : "default"}>
                <ECardBody className="space-y-3 pt-6">
                  {/* Time window + status */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[0.8125rem] font-[550] tabular-nums text-[hsl(var(--e-text-secondary))]">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      {timeWindow}
                      {!isToday ? (
                        <span className="text-[hsl(var(--e-muted-foreground))]">
                          · {format(toZonedTime(j.scheduledDate, TZ), "EEE d MMM")}
                        </span>
                      ) : null}
                    </span>
                    <EBadge tone={isOffered ? "warning" : statusTone(j.status)} soft>
                      {isOffered ? "Offer awaiting your response" : titleCase(j.status)}
                    </EBadge>
                  </div>

                  {/* Property name (large) */}
                  <p className="e-display-sm leading-tight">{j.property.name}</p>

                  {/* Full address — never truncated */}
                  {address ? (
                    <p className="flex items-start gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{address}</span>
                    </p>
                  ) : null}

                  {/* Job type + turnaround rules + expected duration + pay.
                      The timing pills sit beside the job type because they
                      change what the cleaner can do on arrival — "start after
                      12:30" means guests are still in the property. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <EBadge tone="neutral" soft>
                      {titleCase(j.jobType)}
                    </EBadge>
                    <CleanerTimingSummary startTime={j.startTime} dueTime={j.dueTime} timingBadges={resolveTimingBadges(j.internalNotes)} sameDayCheckin={j.sameDayCheckin} sameDayCheckinTime={j.sameDayCheckinTime} />
                    {duration ? (
                      <span className="flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <Timer className="h-3.5 w-3.5" /> {duration}
                      </span>
                    ) : null}
                    {payByJob.has(j.id) ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]">
                        <Coins className="h-3.5 w-3.5 text-[hsl(var(--e-gold-ink))]" />
                        {fmtAud(payByJob.get(j.id)!)}
                      </span>
                    ) : null}
                  </div>

                  {/* OFFERED jobs respond inline before landing in the schedule */}
                  {isOffered ? (
                    <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
                      <p className="mb-2 text-[0.8125rem] font-[550]">
                        You&apos;ve been offered this job — respond to add it to your schedule.
                      </p>
                      <JobOfferActions jobId={j.id} size="md" />
                    </div>
                  ) : null}

                  {/* One primary action per card + optional navigate */}
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                    <EButton asChild variant="gold" className="w-full sm:flex-1">
                      <Link href={`/v2/cleaner/jobs/${j.id}`}>
                        Open job <ChevronRight className="h-4 w-4" />
                      </Link>
                    </EButton>
                    {mapsHref ? (
                      <a href={mapsHref} target="_blank" rel="noreferrer" className="sm:flex-1">
                        <EButton variant="outline" className="w-full">
                          <MapPin className="h-4 w-4" /> Navigate
                        </EButton>
                      </a>
                    ) : null}
                  </div>
                </ECardBody>
              </ECard>
            );
          })}
        </section>
      ) : (
        <EEmptyState
          eyebrow="Today"
          title="No work scheduled today"
          description={nextJob ? `Your next accepted job is ${format(toZonedTime(nextJob.scheduledDate, TZ), "EEE d MMM")} at ${nextJob.property.name}.` : "No jobs or pending offers need a response on this page."}
        />
      )}

      {/* Immediate attention — same feed the v1 dashboard surfaces (overdue
          submissions, unconfirmed jobs, safety check-ins, …), rerouted to v2 */}
      {visibleUrgent.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> NEEDS ATTENTION
          </span>
          {visibleUrgent.map((item) => {
            const href = item.href ? item.href.replace(/^\/cleaner(?=\/|$)/, "/v2/cleaner") : null;
            const tone: Tone =
              item.tone === "critical" ? "danger" : item.tone === "warning" ? "warning" : "info";
            return (
              <ECard
                key={item.id}
                className={
                  item.tone === "critical"
                    ? "border-l-[3px] border-l-[hsl(var(--e-danger))]"
                    : "border-l-[3px] border-l-[hsl(var(--e-warning))]"
                }
              >
                <ECardBody className="flex flex-wrap items-center gap-3 pt-6">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[0.875rem] font-[550]">
                      {item.title}
                      <EBadge tone={tone} soft>
                        {item.count}
                      </EBadge>
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.description}</p>
                  </div>
                  {href ? (
                    <EButton asChild variant="outline" size="sm">
                      <Link href={href}>
                        {item.actionLabel || "Open"} <ChevronRight className="h-4 w-4" />
                      </Link>
                    </EButton>
                  ) : null}
                </ECardBody>
              </ECard>
            );
          })}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <EStatCard label="Accepted today" value={jobsResult === null ? "Unavailable" : String(jobCount)} />
        <EStatCard label="Next 7 days" value={jobsResult === null ? "Unavailable" : String(jobs.filter(j => !isOffer(j) && j.scheduledDate >= todayStart && j.scheduledDate < nextWeek).length)} />
        <EStatCard label="Next" value={jobsResult === null ? "Unavailable" : nextJob?.startTime || "—"} />
      </section>

      {/* Coaching & feedback — self-hides when the cleaner has no records */}
      <CleanerCoachingCard />

      {/* QA feedback — recent inspection outcomes, self-hides when empty */}
      <CleanerQaFeedbackCard />

      {/* End of day (signature moment) */}
      {jobCount > 0 ? (
        <ECard className="border-dashed">
          <ECardBody className="flex items-center gap-3 pt-6 text-[hsl(var(--e-muted-foreground))]">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-[0.8125rem]">
              Review each job before ending your shift. Submitted jobs remain visible while checks finish.
            </p>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
