import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { CheckCircle2 } from "lucide-react";
import { LivePageRefresh } from "@/components/shared/live-page-refresh";
import { sydneyTodayKey, addDaysToKey } from "@/lib/time/sydney-range";
import { isCleanerShiftOffer, SHIFT_ROUTE_STATUSES } from "@/lib/cleaner/shift";
import { ShiftRouteOverview } from "@/components/v2/cleaner/shift-route-overview";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { ECard, ECardBody, EEyebrow, EEmptyState } from "@/components/v2/ui/primitives";
import { DailyBriefing } from "@/components/v2/cleaner/daily-briefing";
import { CleanerCoachingCard } from "@/components/v2/cleaner/coaching-card";
import { CleanerQaFeedbackCard } from "@/components/v2/cleaner/qa-feedback-card";
import { getCleanerImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { resolveTimingBadges } from "@/lib/jobs/timing-badges";
import { computeJobPayForCleaner } from "@/lib/finance/job-pay-for-cleaner";
import { loadPayRateBook } from "@/lib/accounts/pay-rate";
import {
  durationLabel,
  fullAddress,
  greetingFor,
  timeWindow,
  titleCase,
  todaySummaryLine,
  type TodayClockState,
} from "@/lib/cleaner/today-view";
import {
  AttentionList,
  ClockStateCard,
  MyDayList,
  NextJobCard,
  OfferCard,
  type MyDayRow,
  type TodayJobView,
} from "@/components/v2/cleaner/today/today-cards";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { tourTarget } from "@/lib/tutorials/targets";

export const metadata = { title: "Today · Estate cleaner" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

/**
 * This cleaner's active jobs for the next 7 days plus their pending offers.
 * Assignment-scoped to the session user (removedAt null, open statuses only),
 * so a cleaner never sees another cleaner's work.
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
        assignments: { where: { removedAt: null }, select: { userId: true, payRate: true, responseStatus: true } },
        property: { select: { name: true, address: true, suburb: true, state: true, postcode: true, cleaningDurationMinutes: true } },
      },
      orderBy: [{ scheduledDate: "asc" }, { priorityBucket: "asc" }, { dueTime: "asc" }, { startTime: "asc" }],
    })
    .catch(() => null);
}

type WeekJob = NonNullable<Awaited<ReturnType<typeof getCleanerWeekJobs>>>[number];

/**
 * The cleaner's open time log, read-only. A failed read is "unknown", never
 * "not clocked in": the card must not claim a clock state nobody checked.
 */
async function getOpenClock(userId: string): Promise<TodayClockState> {
  try {
    const log = await db.timeLog.findFirst({
      where: { userId, stoppedAt: null },
      orderBy: { startedAt: "desc" },
      select: { jobId: true, startedAt: true, job: { select: { property: { select: { name: true } } } } },
    });
    if (!log) return { kind: "not-clocked-in" };
    return {
      kind: "clocked-in",
      jobId: log.jobId,
      propertyName: log.job?.property?.name ?? "Your job",
      since: format(toZonedTime(log.startedAt, TZ), "HH:mm"),
    };
  } catch {
    return { kind: "unknown" };
  }
}

function mapsDirections(address: string): string | null {
  return address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : null;
}

export default async function CleanerTodayPage() {
  const session = await requireRole([Role.CLEANER]);
  const cleanerName = session.user.name?.trim()?.split(" ")[0] || session.user.email?.split("@")[0] || "there";

  const now = toZonedTime(new Date(), TZ);
  const dayKey = sydneyTodayKey();
  const todayStart = new Date(`${dayKey}T00:00:00.000Z`);
  const nextWeek = new Date(`${addDaysToKey(dayKey, 7)}T00:00:00.000Z`);

  const [jobsResult, attentionResult, settings, cleanerUser, rateBook, clock] = await Promise.all([
    getCleanerWeekJobs(session.user.id, todayStart, nextWeek),
    getCleanerImmediateAttention(session.user.id).catch(() => null),
    getAppSettings().catch(() => null),
    db.user.findUnique({ where: { id: session.user.id }, select: { hourlyRate: true } }).catch(() => null),
    // The default rate in force on each job's day (effective-dated history).
    loadPayRateBook([session.user.id]).catch(() => null),
    getOpenClock(session.user.id),
  ]);

  const jobs = jobsResult ?? [];
  const isOffer = (job: WeekJob) => isCleanerShiftOffer(job, session.user.id);
  const isToday = (job: WeekJob) => job.scheduledDate.toISOString().slice(0, 10) === dayKey;

  // Per-job pay for THIS cleaner (same canonical math as the job screen/briefing).
  function payFor(job: WeekJob): number | null {
    if (!settings) return null;
    const meta = parseJobInternalNotes(job.internalNotes ?? null);
    return computeJobPayForCleaner({
      cleanerId: session.user.id,
      job: { jobType: job.jobType, estimatedHours: job.estimatedHours, isRework: job.isRework, reworkPayAmount: job.reworkPayAmount },
      assignments: job.assignments.map((assignment) => ({ userId: assignment.userId, payRate: assignment.payRate ?? null })),
      userHourlyRate: rateBook ? rateBook.rateFor(session.user.id, job.scheduledDate, cleanerUser?.hourlyRate ?? null) : null,
      cleanerJobHourlyRates: settings.cleanerJobHourlyRates,
      cleanerPayouts: meta.cleanerPayouts,
      transportAllowances: meta.transportAllowances,
    });
  }

  function view(job: WeekJob): TodayJobView {
    const address = fullAddress(job.property);
    return {
      id: job.id,
      propertyName: job.property.name,
      address,
      window: timeWindow(job.startTime, job.dueTime),
      otherDayLabel: isToday(job) ? null : format(toZonedTime(job.scheduledDate, TZ), "EEE d MMM"),
      jobTypeLabel: titleCase(job.jobType),
      status: job.status,
      duration: durationLabel(job.property.cleaningDurationMinutes, job.estimatedHours),
      pay: payFor(job),
      startTime: job.startTime,
      dueTime: job.dueTime,
      sameDayCheckin: job.sameDayCheckin,
      sameDayCheckinTime: job.sameDayCheckinTime,
      timingBadges: resolveTimingBadges(job.internalNotes),
      mapsHref: mapsDirections(address),
    };
  }

  const offeredJobs = jobs.filter(isOffer);
  const todayJobs = jobs.filter((job) => !isOffer(job) && isToday(job));
  const routeJobs = todayJobs.filter((job) => SHIFT_ROUTE_STATUSES.includes(job.status));
  const nextJob = jobs.find((job) => !isOffer(job) && SHIFT_ROUTE_STATUSES.includes(job.status) && job.scheduledDate >= todayStart) ?? null;
  const weekCount = jobs.filter((job) => !isOffer(job) && job.scheduledDate >= todayStart && job.scheduledDate < nextWeek).length;
  const visibleAttention = (attentionResult ?? []).filter((item) => Number(item.count) > 0);

  const myDayRows: MyDayRow[] = todayJobs.map((job) => ({
    id: job.id,
    time: job.startTime ?? "TBC",
    propertyName: job.property.name,
    status: job.status,
    facts: [titleCase(job.jobType), durationLabel(job.property.cleaningDurationMinutes, job.estimatedHours)].filter(Boolean).join(" · "),
  }));

  const dateLine = format(now, "EEEE · d MMMM");
  const loaded = jobsResult !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <LivePageRefresh />
      <header className="e-rise">
        <EEyebrow>{dateLine}</EEyebrow>
        <h1 className="e-display-md mt-1">{greetingFor(now.getHours())}, {cleanerName}.</h1>
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          {todaySummaryLine(loaded ? todayJobs.length : null, loaded ? offeredJobs.length : null)}
        </p>
      </header>

      {!loaded || attentionResult === null ? (
        <div role="alert" className={`rounded-[var(--e-radius)] ${toneNoticeClass("problem")} p-3 text-sm`}>
          {!loaded ? "Jobs and route are unavailable. " : ""}
          {attentionResult === null ? "Attention items are unavailable. " : ""}
          Refresh this page to try again.
        </div>
      ) : null}

      {/* data-tour-busy: tours never start while this cleaner's clock is running. */}
      <div {...tourTarget("cleaner.today.clock")} data-tour-busy={clock.kind === "clocked-in" ? "clock" : undefined}>
        <ClockStateCard state={clock} />
      </div>

      {/* Today's brief before the jobs: reading it after the list is too late to plan the day. */}
      <DailyBriefing />

      {nextJob ? (
        <div {...tourTarget("cleaner.today.nextJob")}>
          <NextJobCard job={view(nextJob)} routeHref={isToday(nextJob) ? "/v2/cleaner/route" : null} />
        </div>
      ) : null}

      {offeredJobs.length > 0 ? (
        <section {...tourTarget("cleaner.today.offer")} aria-label="Job offers" className="space-y-2">
          {offeredJobs.map((job) => (
            <OfferCard key={job.id} job={view(job)} dayLabel={format(toZonedTime(job.scheduledDate, TZ), "EEE d MMM")} />
          ))}
        </section>
      ) : null}

      <AttentionList items={visibleAttention} />
      {/* Coaching and QA results self-hide when there is nothing to read. */}
      <CleanerCoachingCard />
      <CleanerQaFeedbackCard />

      {loaded ? (
        <section aria-labelledby="today-my-day" className="space-y-2">
          <h2 id="today-my-day" className="e-eyebrow">My day</h2>
          <ShiftRouteOverview
            userId={session.user.id}
            day={dayKey}
            stops={routeJobs.map((job) => ({ jobId: job.id, property: job.property.name, address: fullAddress(job.property), startTime: job.startTime, status: job.status }))}
          />
          {myDayRows.length > 0 ? (
            <MyDayList rows={myDayRows} />
          ) : (
            <EEmptyState
              eyebrow="Today"
              title="No work scheduled today"
              description={nextJob ? `Your next accepted job is ${format(toZonedTime(nextJob.scheduledDate, TZ), "EEE d MMM")} at ${nextJob.property.name}.` : "No jobs or pending offers need a response on this page."}
            />
          )}
          <p className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            <span>{weekCount} accepted job{weekCount === 1 ? "" : "s"} in the next 7 days.</span>
            <Link href="/v2/cleaner/jobs" className="inline-flex min-h-11 items-center font-[550] underline-offset-2 hover:underline">All jobs</Link>
          </p>
        </section>
      ) : null}

      <p className="flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <span>Shift snapshot from this page load.</span>
        <a href="/v2/cleaner" className="inline-flex min-h-11 items-center underline">Refresh shift</a>
      </p>

      {todayJobs.length > 0 ? (
        <ECard className="border-dashed">
          <ECardBody className="flex items-center gap-3 pt-6 text-[hsl(var(--e-muted-foreground))]">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            <p className="text-[0.8125rem]">Review each job before ending your shift. Submitted jobs remain visible while checks finish.</p>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
