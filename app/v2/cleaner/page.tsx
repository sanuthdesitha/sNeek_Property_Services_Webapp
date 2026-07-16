import Link from "next/link";
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
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, MapPin, Timer } from "lucide-react";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { DailyBriefing } from "@/components/v2/cleaner/daily-briefing";
import { CleanerCoachingCard } from "@/components/v2/cleaner/coaching-card";
import { getCleanerImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { autoClockOutStaleTimeLogsForUser } from "@/lib/time/auto-clockout";

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
        scheduledDate: { gte: todayStart, lt: nextWeek },
        status: { notIn: ["COMPLETED", "INVOICED"] },
      },
      select: {
        id: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        estimatedHours: true,
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
    .catch(() => []);
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
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextWeek = new Date(todayStart.getTime() + 7 * 86_400_000);

  const [jobs, urgentItems] = await Promise.all([
    getCleanerWeekJobs(session.user.id, todayStart, nextWeek),
    getCleanerImmediateAttention(session.user.id).catch(() => []),
  ]);

  const visibleUrgent = urgentItems.filter((item) => Number(item.count) > 0);
  const offeredJobs = jobs.filter((j) => j.status === "OFFERED");
  const todayJobs = jobs.filter((j) => isSameLocalDay(toZonedTime(j.scheduledDate, TZ), now));
  const nextJob = todayJobs[0] ?? jobs[0] ?? null;

  // "My day" = everything that wants your attention today: today's scheduled
  // jobs plus any outstanding offers (which may be for a future day). `jobs` is
  // already ordered by date → priority → time, so the timeline stays in order.
  const myDay = jobs.filter(
    (j) => j.status === "OFFERED" || isSameLocalDay(toZonedTime(j.scheduledDate, TZ), now)
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
          {jobCount === 0
            ? "No jobs scheduled today — enjoy the day."
            : `${jobCount} job${jobCount === 1 ? "" : "s"} today.`}
        </p>
      </header>

      {/* Cleaner daily briefing — concise plan-your-day panel with weather */}
      <DailyBriefing />

      {/* Coaching & feedback — self-hides when the cleaner has no records */}
      <CleanerCoachingCard />

      <section className="grid grid-cols-3 gap-3">
        <EStatCard label="Today" value={String(jobCount)} />
        <EStatCard label="This week" value={String(jobs.length)} />
        <EStatCard label="Next" value={nextJob?.startTime || "—"} />
      </section>

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

      {/* My day — one vertical timeline of today's jobs + outstanding offers */}
      {myDay.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow">MY DAY</span>
          {myDay.map((j) => {
            const isOffered = j.status === "OFFERED";
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
                    <EBadge tone={statusTone(j.status)} soft>
                      {titleCase(j.status)}
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

                  {/* Job type + expected duration */}
                  <div className="flex flex-wrap items-center gap-2">
                    <EBadge tone="neutral" soft>
                      {titleCase(j.jobType)}
                    </EBadge>
                    {duration ? (
                      <span className="flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <Timer className="h-3.5 w-3.5" /> {duration}
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
          eyebrow="All clear"
          title="Nothing scheduled"
          description="You have no jobs booked for today or the days ahead."
        />
      )}

      {/* End of day (signature moment) */}
      {jobCount > 0 ? (
        <ECard className="border-dashed">
          <ECardBody className="flex items-center gap-3 pt-6 text-[hsl(var(--e-muted-foreground))]">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-[0.8125rem]">
              Finish {jobCount === 1 ? "it" : `all ${jobCount}`} and the day closes with a flourish.
            </p>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
