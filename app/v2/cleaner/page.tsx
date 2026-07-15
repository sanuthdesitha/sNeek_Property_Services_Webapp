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
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, MapPin, BellRing, Megaphone, Pin } from "lucide-react";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { DailyBriefing } from "@/components/v2/cleaner/daily-briefing";
import { CleanerCoachingCard } from "@/components/v2/cleaner/coaching-card";
import { getCleanerImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { getWorkforceDashboardPosts } from "@/lib/workforce/service";
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
        property: { select: { name: true, address: true, suburb: true } },
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

  const [jobs, urgentItems, teamPosts] = await Promise.all([
    getCleanerWeekJobs(session.user.id, todayStart, nextWeek),
    getCleanerImmediateAttention(session.user.id).catch(() => []),
    getWorkforceDashboardPosts(session.user.id, 3).catch(() => []),
  ]);

  const visibleUrgent = urgentItems.filter((item) => Number(item.count) > 0);
  const offeredJobs = jobs.filter((j) => j.status === "OFFERED");
  const todayJobs = jobs.filter((j) => isSameLocalDay(toZonedTime(j.scheduledDate, TZ), now));
  const laterToday = todayJobs.slice(1);
  const nextJob = todayJobs[0] ?? jobs[0] ?? null;

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

      {/* Cleaner daily briefing — concise plan-your-day panel (Today | Tomorrow) */}
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

      {/* Offered jobs — accept or decline before they land in the schedule */}
      {offeredJobs.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow flex items-center gap-1.5">
            <BellRing className="h-3.5 w-3.5" /> NEW OFFERS ({offeredJobs.length})
          </span>
          {offeredJobs.map((j) => (
            <ECard key={j.id} variant="ceremony">
              <ECardBody className="space-y-3 pt-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/v2/cleaner/jobs/${j.id}`}
                      className="truncate text-[0.9375rem] font-[600] hover:underline"
                    >
                      {j.property.name}
                    </Link>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {[
                        format(toZonedTime(j.scheduledDate, TZ), "EEE d MMM"),
                        j.startTime || null,
                        titleCase(j.jobType),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <EBadge tone="warning" soft>
                    Offered
                  </EBadge>
                </div>
                <JobOfferActions jobId={j.id} size="md" />
              </ECardBody>
            </ECard>
          ))}
        </section>
      ) : null}

      {/* Next job — the hero card */}
      {nextJob ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <EEyebrow>
                {todayJobs[0]?.id === nextJob.id ? "NEXT JOB · TODAY" : "NEXT JOB"}
              </EEyebrow>
              <EBadge tone="info" soft>
                <Clock className="h-3 w-3" />{" "}
                {nextJob.startTime ? `Due ${nextJob.startTime}` : "TBC"}
              </EBadge>
            </div>
            <p className="e-display-sm">{nextJob.property.name}</p>
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              {[nextJob.property.suburb, titleCase(nextJob.jobType)].filter(Boolean).join(" · ")}
            </p>
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {[nextJob.property.address, nextJob.property.suburb].filter(Boolean).join(", ")}
              </span>
            </p>
            {nextJob.status === "OFFERED" ? (
              <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
                <p className="mb-2 text-[0.8125rem] font-[550]">
                  You've been offered this job — respond to add it to your schedule.
                </p>
                <JobOfferActions jobId={nextJob.id} size="md" />
              </div>
            ) : null}
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <EButton asChild variant="gold" className="w-full"><Link href={`/v2/cleaner/jobs/${nextJob.id}`} className="flex-1">
                  Open job <ChevronRight className="h-4 w-4" />
                </Link></EButton>
              {[nextJob.property.address, nextJob.property.suburb].filter(Boolean).length > 0 ? (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                    [nextJob.property.address, nextJob.property.suburb].filter(Boolean).join(", ")
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1"
                >
                  <EButton variant="outline" className="w-full">
                    <MapPin className="h-4 w-4" /> Navigate
                  </EButton>
                </a>
              ) : null}
            </div>
          </ECardBody>
        </ECard>
      ) : (
        <EEmptyState
          eyebrow="All clear"
          title="Nothing scheduled"
          description="You have no jobs booked for today or the days ahead."
        />
      )}

      {/* Later today */}
      {laterToday.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow">LATER TODAY</span>
          {laterToday.map((j) => {
            const isOffered = j.status === "OFFERED";
            const body = (
              <ECardBody className="flex flex-wrap items-center gap-3 pt-6">
                <div className="flex h-11 w-11 flex-col items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]">
                  <span className="text-[0.8125rem] font-semibold tabular-nums">
                    {j.startTime || "—"}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.875rem] font-[550]">{j.property.name}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {titleCase(j.jobType)}
                  </p>
                </div>
                <EBadge tone={statusTone(j.status)} soft>
                  {titleCase(j.status)}
                </EBadge>
                {isOffered ? (
                  <div className="w-full">
                    <JobOfferActions jobId={j.id} size="sm" />
                  </div>
                ) : null}
              </ECardBody>
            );
            // OFFERED rows carry inline Accept/Decline buttons, so they must not
            // be wrapped in an anchor (no interactive controls inside a link).
            return isOffered ? (
              <ECard key={j.id}>{body}</ECard>
            ) : (
              <Link key={j.id} href={`/v2/cleaner/jobs/${j.id}`} className="block">
                <ECard>{body}</ECard>
              </Link>
            );
          })}
        </section>
      ) : null}

      {/* Team updates — the latest workforce posts, same feed as the v1 dashboard */}
      {teamPosts.length > 0 ? (
        <section className="space-y-3">
          <span className="e-eyebrow flex items-center gap-1.5">
            <Megaphone className="h-3.5 w-3.5" /> TEAM UPDATES
          </span>
          {teamPosts.map((post: any) => (
            <ECard key={post.id} variant={post.pinned ? "ceremony" : "default"}>
              <ECardBody className="space-y-2 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {post.pinned ? <Pin className="h-3.5 w-3.5 text-[hsl(var(--e-gold-ink))]" /> : null}
                    <EBadge tone={post.type === "RECOGNITION" ? "gold" : "info"} soft>
                      {titleCase(String(post.type || "UPDATE"))}
                    </EBadge>
                  </div>
                  <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    {format(toZonedTime(new Date(post.createdAt), TZ), "d MMM")}
                  </span>
                </div>
                <p className="text-[0.9375rem] font-[550]">{post.title}</p>
                <p className="line-clamp-3 whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
                  {post.body}
                </p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {post.createdBy?.name || "Team"}
                </p>
              </ECardBody>
            </ECard>
          ))}
          <EButton asChild variant="ghost" size="sm">
            <Link href="/v2/cleaner/hub">
              Open team hub <ChevronRight className="h-4 w-4" />
            </Link>
          </EButton>
        </section>
      ) : null}

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
