import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { PayAdjustmentStatus, Prisma, Role } from "@prisma/client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  CalendarDays,
  ChevronRight,
  Clock,
  CreditCard,
  FileWarning,
  HandCoins,
  MapPin,
} from "lucide-react";
import {
  getJobTimingHighlights,
  mergeUniqueJobHighlights,
  parseJobInternalNotes,
} from "@/lib/jobs/meta";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { getCleanerImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { autoClockOutStaleTimeLogsForUser } from "@/lib/time/auto-clockout";

const TZ = "Australia/Sydney";

const STATUS_COLORS: Record<string, any> = {
  UNASSIGNED: "warning",
  ASSIGNED: "secondary",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "destructive",
  SUBMITTED: "success",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "outline",
};

function isMissingSchemaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

async function safeValue<T>(query: Promise<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (isMissingSchemaError(error)) return fallback;
    throw error;
  }
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

function isSameLocalDay(date: Date, now: Date) {
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

export default async function CleanerDashboard() {
  const session = await requireRole([Role.CLEANER]);
  await autoClockOutStaleTimeLogsForUser(session.user.id);
  const settings = await getAppSettings();
  const visibility = settings.cleanerPortalVisibility;
  const cleanerName =
    session.user.name?.trim() || session.user.email?.split("@")[0] || "Cleaner";

  const now = toZonedTime(new Date(), TZ);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextWeek = new Date(todayStart.getTime() + 7 * 86400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const jobs = await db.job.findMany({
    where: {
      assignments: { some: { userId: session.user.id } },
      scheduledDate: { gte: todayStart, lt: nextWeek },
      status: { notIn: ["COMPLETED", "INVOICED"] },
    },
    select: {
      id: true,
      jobType: true,
      status: true,
      notes: true,
      scheduledDate: true,
      startTime: true,
      dueTime: true,
      priorityBucket: true,
      priorityReason: true,
      internalNotes: true,
      property: { select: { name: true, address: true, suburb: true } },
    },
    orderBy: [
      { scheduledDate: "asc" },
      { priorityBucket: "asc" },
      { dueTime: "asc" },
      { startTime: "asc" },
    ],
  });

  const ongoingJob = await db.job.findFirst({
    where: {
      assignments: { some: { userId: session.user.id } },
      status: "IN_PROGRESS",
    },
    select: {
      id: true,
      jobType: true,
      status: true,
      notes: true,
      scheduledDate: true,
      startTime: true,
      dueTime: true,
      priorityReason: true,
      internalNotes: true,
      property: { select: { name: true, address: true, suburb: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { scheduledDate: "asc" }],
  });

  const completedJobs = await db.job.findMany({
    where: {
      assignments: { some: { userId: session.user.id } },
      status: { in: ["COMPLETED", "INVOICED", "SUBMITTED", "QA_REVIEW"] },
    },
    select: {
      id: true,
      jobType: true,
      status: true,
      scheduledDate: true,
      property: { select: { name: true, suburb: true } },
      report: { select: { id: true } },
    },
    orderBy: { scheduledDate: "desc" },
    take: 10,
  });

  const [monthLogs, pendingExtraRequests, approvedExtraRows] = await Promise.all([
    db.timeLog.findMany({
      where: {
        userId: session.user.id,
        startedAt: { gte: monthStart },
        stoppedAt: { not: null },
      },
      select: { durationM: true },
    }),
    safeValue(
      db.cleanerPayAdjustment.count({
        where: {
          cleanerId: session.user.id,
          status: PayAdjustmentStatus.PENDING,
        },
      }),
      0
    ),
    safeValue(
      db.cleanerPayAdjustment.findMany({
        where: {
          cleanerId: session.user.id,
          status: PayAdjustmentStatus.APPROVED,
          reviewedAt: { gte: monthStart },
        },
        select: {
          approvedAmount: true,
          requestedAmount: true,
        },
      }),
      []
    ),
  ]);
  const urgentItems = await getCleanerImmediateAttention(session.user.id);

  const totalHoursMonth = monthLogs.reduce((sum, row) => sum + (row.durationM ?? 0) / 60, 0);
  const approvedExtrasMonth = approvedExtraRows.reduce(
    (sum, row) => sum + Number(row.approvedAmount ?? row.requestedAmount ?? 0),
    0
  );

  const todayJobs = jobs.filter((job) => isSameLocalDay(toZonedTime(job.scheduledDate, TZ), now));
  const upcomingJobs = jobs.filter((job) => !isSameLocalDay(toZonedTime(job.scheduledDate, TZ), now));
  const nextJob = todayJobs[0] ?? upcomingJobs[0] ?? null;
  const nextJobMeta = nextJob ? parseJobInternalNotes(nextJob.internalNotes) : null;
  const nextJobTimingHighlights = nextJob
    ? mergeUniqueJobHighlights(
        getJobTimingHighlights(nextJobMeta ?? parseJobInternalNotes(nextJob.internalNotes)),
        [nextJob.priorityReason]
      )
    : [];
  const ongoingJobMeta = ongoingJob ? parseJobInternalNotes(ongoingJob.internalNotes) : null;
  const ongoingJobTimingHighlights = ongoingJob
    ? mergeUniqueJobHighlights(
        getJobTimingHighlights(ongoingJobMeta ?? parseJobInternalNotes(ongoingJob.internalNotes)),
        [ongoingJob.priorityReason]
      )
    : [];

  function JobCard({ job }: { job: (typeof jobs)[0] }) {
    const jobMeta = parseJobInternalNotes(job.internalNotes);
    const timingHighlights = mergeUniqueJobHighlights(getJobTimingHighlights(jobMeta), [job.priorityReason]);
    const hasCleanerNotes = Boolean(
      jobMeta.internalNoteText && jobMeta.internalNoteText.trim()
    );
    return (
      <Link href={`/cleaner/jobs/${job.id}`} className="block">
        <Card className="transition-all hover:border-primary/35 hover:shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                <CalendarDays className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold sm:text-base">{job.property.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {job.property.address}, {job.property.suburb}
                      </span>
                    </p>
                  </div>
                  <Badge variant={STATUS_COLORS[job.status]}>{job.status.replace(/_/g, " ")}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground sm:text-sm">
                  <span className="font-medium text-primary">
                    {format(toZonedTime(job.scheduledDate, TZ), "EEE dd MMM")}
                  </span>
                  {job.startTime ? (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {job.startTime}
                      {job.dueTime ? ` - ${job.dueTime}` : ""}
                    </span>
                  ) : null}
                  <span>{job.jobType.replace(/_/g, " ")}</span>
                </div>
                {timingHighlights.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {timingHighlights.map((line) => (
                      <Badge key={`${job.id}-${line}`} variant="warning">
                        {line}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {(jobMeta.tags?.length ?? 0) > 0 || hasCleanerNotes ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {jobMeta.tags?.map((tag) => (
                      <Badge
                        key={`${job.id}-tag-${tag}`}
                        variant="secondary"
                        className="border-sky-200 bg-sky-50 text-sky-800"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {hasCleanerNotes ? (
                      <Badge variant="secondary" className="border-blue-200 bg-blue-50 text-blue-800">
                        Notes
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <ChevronRight className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-primary/20">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.25fr_0.9fr]">
            <div className="p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Daily Overview
              </p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
                Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"},{" "}
                {cleanerName}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                {format(now, "EEEE, d MMMM")} in {TZ}. Your dashboard keeps current jobs, pay requests,
                invoices, and recent completions in one place.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {visibility.showJobs && (
                  <Button asChild size="sm">
                    <Link href="/cleaner/jobs">Open today&apos;s jobs</Link>
                  </Button>
                )}
                {visibility.showJobs && (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/cleaner/jobs?scope=completed">Job history</Link>
                  </Button>
                )}
                {visibility.showInvoices && (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/cleaner/invoices">Invoices</Link>
                  </Button>
                )}
              </div>
            </div>

            <div className="border-t border-border/60 bg-muted/20 p-5 sm:p-6 lg:border-l lg:border-t-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Next Job
              </p>
              {visibility.showJobs && nextJob ? (
                <Link
                  href={`/cleaner/jobs/${nextJob.id}`}
                  className="mt-3 block rounded-2xl border border-border/70 bg-white/70 p-3 transition hover:border-primary/35 hover:shadow-sm"
                >
                  <div className="space-y-3">
                    <div>
                      <p className="text-base font-semibold">{nextJob.property.name}</p>
                      <p className="text-sm text-muted-foreground">{nextJob.property.suburb}</p>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p>{format(toZonedTime(nextJob.scheduledDate, TZ), "EEE dd MMM yyyy")}</p>
                      <p>
                        {nextJob.startTime || "Time not set"}
                        {nextJob.dueTime ? ` - ${nextJob.dueTime}` : ""}
                      </p>
                      <p className="text-muted-foreground">{nextJob.jobType.replace(/_/g, " ")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_COLORS[nextJob.status]}>{nextJob.status.replace(/_/g, " ")}</Badge>
                      <span className="text-xs font-medium text-primary">Open job</span>
                    </div>
                    {nextJobTimingHighlights.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {nextJobTimingHighlights.map((line) => (
                          <Badge key={`next-${line}`} variant="warning">
                            {line}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {(nextJobMeta?.tags?.length ?? 0) > 0 ||
                    Boolean(
                      nextJobMeta?.internalNoteText && nextJobMeta.internalNoteText.trim()
                    ) ? (
                      <div className="flex flex-wrap gap-2">
                        {nextJobMeta?.tags?.map((tag) => (
                          <Badge
                            key={`next-tag-${tag}`}
                            variant="secondary"
                            className="border-sky-200 bg-sky-50 text-sky-800"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {Boolean(
                          nextJobMeta?.internalNoteText && nextJobMeta.internalNoteText.trim()
                        ) ? (
                          <Badge variant="secondary" className="border-blue-200 bg-blue-50 text-blue-800">
                            Cleaner Notes
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </Link>
              ) : visibility.showJobs ? (
                <p className="mt-3 text-sm text-muted-foreground">No scheduled jobs in the next 7 days.</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">The jobs module is currently hidden by admin.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {ongoingJob && visibility.showJobs && (
        <Card className="border-emerald-500/45 bg-emerald-50/70">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Ongoing Job
                </p>
                <p className="mt-1 text-lg font-semibold text-emerald-900">{ongoingJob.property.name}</p>
                <p className="mt-0.5 text-sm text-emerald-800">
                  {ongoingJob.property.address}, {ongoingJob.property.suburb}
                </p>
                <p className="mt-2 text-sm text-emerald-900">
                  {format(toZonedTime(ongoingJob.scheduledDate, TZ), "EEE dd MMM yyyy")}
                  {ongoingJob.startTime ? ` | ${ongoingJob.startTime}` : ""}
                  {ongoingJob.dueTime ? ` - ${ongoingJob.dueTime}` : ""}
                </p>
                <p className="text-xs text-emerald-800">{ongoingJob.jobType.replace(/_/g, " ")}</p>
                {ongoingJobTimingHighlights.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ongoingJobTimingHighlights.map((line) => (
                      <Badge key={`ongoing-${line}`} variant="warning">
                        {line}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {(ongoingJobMeta?.tags?.length ?? 0) > 0 ||
                Boolean(
                  ongoingJobMeta?.internalNoteText && ongoingJobMeta.internalNoteText.trim()
                ) ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ongoingJobMeta?.tags?.map((tag) => (
                      <Badge
                        key={`ongoing-tag-${tag}`}
                        variant="secondary"
                        className="border-sky-200 bg-sky-50 text-sky-800"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {Boolean(
                      ongoingJobMeta?.internalNoteText && ongoingJobMeta.internalNoteText.trim()
                    ) ? (
                      <Badge variant="secondary" className="border-blue-200 bg-blue-50 text-blue-800">
                        Cleaner Notes
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="default">In Progress</Badge>
                <Button asChild size="sm">
                  <Link href={`/cleaner/jobs/${ongoingJob.id}`}>Open ongoing job</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <ImmediateAttentionPanel
        title="Immediate Attention"
        description="Items that need action before moving to the next task."
        items={urgentItems}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <CalendarDays className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Jobs today</p>
              <p className="text-2xl font-semibold">{todayJobs.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hours this month</p>
              <p className="text-2xl font-semibold">{totalHoursMonth.toFixed(2)}h</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <HandCoins className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending pay requests</p>
              <p className="text-2xl font-semibold">{pendingExtraRequests}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Approved extras</p>
              <p className="text-2xl font-semibold">{formatCurrency(approvedExtrasMonth)}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.9fr]">
        {visibility.showJobs && <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Today&apos;s Schedule</CardTitle>
            <CardDescription>
              Start from here and move into the job form from each task.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {todayJobs.length > 0 ? (
              todayJobs.map((job) => <JobCard key={job.id} job={job} />)
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                No jobs scheduled for today.
              </div>
            )}
          </CardContent>
        </Card>}

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Quick Tools</CardTitle>
              <CardDescription>Core actions used during the day.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {visibility.showInvoices && (
                <Link href="/cleaner/invoices" className="rounded-2xl border border-border/70 bg-white/70 p-3 transition-colors hover:border-primary/35">
                  <p className="text-sm font-semibold">Invoices</p>
                  <p className="mt-1 text-xs text-muted-foreground">Preview, download, or email invoice PDFs.</p>
                </Link>
              )}
              {visibility.showPayRequests && (
                <Link href="/cleaner/pay-requests" className="rounded-2xl border border-border/70 bg-white/70 p-3 transition-colors hover:border-primary/35">
                  <p className="text-sm font-semibold">Extra Pay Requests</p>
                  <p className="mt-1 text-xs text-muted-foreground">Submit and track hourly or fixed extras.</p>
                </Link>
              )}
              {visibility.showLostFound && (
                <Link href="/cleaner/lost-found" className="rounded-2xl border border-border/70 bg-white/70 p-3 transition-colors hover:border-primary/35">
                  <p className="text-sm font-semibold">Lost &amp; Found</p>
                  <p className="mt-1 text-xs text-muted-foreground">Log items, photos, and admin notes.</p>
                </Link>
              )}
              {!visibility.showInvoices && !visibility.showPayRequests && !visibility.showLostFound && (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                  All quick-tool modules are currently hidden by admin.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Recent Completions</CardTitle>
              <CardDescription>Latest finished work and client reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {completedJobs.length > 0 ? (
                completedJobs.map((job) => (
                  <div key={job.id} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{job.property.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.property.suburb} • {format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}
                        </p>
                      </div>
                      <Badge variant={STATUS_COLORS[job.status]}>{job.status.replace(/_/g, " ")}</Badge>
                    </div>
                    {job.report ? (
                      <a
                        href={`/api/reports/${job.id}/download`}
                        className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                      >
                        Open report
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
                  No completed jobs yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Upcoming This Week</CardTitle>
          <CardDescription>Everything already assigned after today.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {upcomingJobs.length > 0 ? (
            upcomingJobs.map((job) => <JobCard key={job.id} job={job} />)
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
              No upcoming assigned jobs right now.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <FileWarning className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Completed jobs tracked</p>
              <p className="text-xs text-muted-foreground">
                {completedJobs.length} recent completion{completedJobs.length === 1 ? "" : "s"} shown here.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/cleaner/jobs?scope=completed">View full history</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

