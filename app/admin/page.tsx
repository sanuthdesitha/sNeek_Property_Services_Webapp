import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role, JobStatus, PayAdjustmentStatus } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import {
  CheckCircle2,
  Plus,
  FileText,
  UserPlus,
  Home,
  MessageSquare,
  MapPin,
  DollarSign,
  Users,
  Receipt,
  Star,
  ClipboardCheck,
  PackageMinus,
  Navigation,
  Trophy,
  ArrowRight,
  AlertTriangle,
  History,
  HeartPulse,
  CalendarRange,
} from "lucide-react";
import { addDays, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Link from "next/link";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { KpiTile } from "@/components/charts";
import { OpsAnalyticsRow } from "@/components/admin/ops-analytics-row";
import { getAdminImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { getDashboardMetrics } from "@/lib/admin/dashboard";

function statusToPillVariant(
  status: JobStatus,
): "primary" | "info" | "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case JobStatus.UNASSIGNED:
    case JobStatus.OFFERED:
      return "warning";
    case JobStatus.ASSIGNED:
      return "primary";
    case JobStatus.IN_PROGRESS:
    case JobStatus.PAUSED:
    case JobStatus.WAITING_CONTINUATION_APPROVAL:
      return "info";
    case JobStatus.SUBMITTED:
    case JobStatus.QA_REVIEW:
      return "warning";
    case JobStatus.COMPLETED:
    case JobStatus.INVOICED:
      return "success";
    default:
      return "neutral";
  }
}

const TZ = "Australia/Sydney";

function formatAud(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

const QUICK_LAUNCH = [
  { label: "New job", href: "/admin/jobs/new", icon: Plus },
  { label: "New quote", href: "/admin/quotes/new", icon: FileText },
  { label: "New client", href: "/admin/clients/new", icon: UserPlus },
  { label: "Add property", href: "/admin/properties/new", icon: Home },
  { label: "Send message", href: "/admin/messages/compose", icon: MessageSquare },
  { label: "Live ops map", href: "/admin/ops", icon: MapPin },
];

async function getRecentJobs(todayStart: Date, todayEnd: Date) {
  const [todaysRecentJobs, upcomingRecentJobs, recentPastJobs, chartRows] =
    await Promise.all([
      db.job.findMany({
        where: { scheduledDate: { gte: todayStart, lt: todayEnd } },
        take: 6,
        orderBy: [
          { priorityBucket: "asc" },
          { startTime: "asc" },
          { dueTime: "asc" },
          { createdAt: "desc" },
        ],
        select: {
          id: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          property: { select: { name: true, suburb: true } },
          assignments: {
            select: { user: { select: { name: true } } },
            take: 1,
          },
        },
      }),
      db.job.findMany({
        where: { scheduledDate: { gte: todayEnd } },
        take: 4,
        orderBy: [
          { scheduledDate: "asc" },
          { priorityBucket: "asc" },
          { startTime: "asc" },
        ],
        select: {
          id: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          property: { select: { name: true, suburb: true } },
          assignments: { select: { user: { select: { name: true } } }, take: 1 },
        },
      }),
      db.job.findMany({
        where: { scheduledDate: { lt: todayStart } },
        take: 4,
        orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          property: { select: { name: true, suburb: true } },
          assignments: { select: { user: { select: { name: true } } }, take: 1 },
        },
      }),
      db.job.findMany({
        where: {
          scheduledDate: { gte: todayStart, lt: addDays(todayStart, 7) },
        },
        select: { status: true, scheduledDate: true },
        take: 2000,
        orderBy: { scheduledDate: "asc" },
      }),
    ]);

  const recentJobs = [
    ...todaysRecentJobs,
    ...upcomingRecentJobs,
    ...recentPastJobs,
  ].slice(0, 10);

  const upcomingSevenDayLoad = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(todayStart, index);
    const key = day.toISOString().slice(0, 10);
    return {
      date: key,
      label: format(day, "EEE"),
      dayOfMonth: format(day, "d"),
      jobs: chartRows.filter(
        (row) => row.scheduledDate.toISOString().slice(0, 10) === key,
      ).length,
      unassigned: chartRows.filter(
        (row) =>
          row.scheduledDate.toISOString().slice(0, 10) === key &&
          (row.status === JobStatus.UNASSIGNED || row.status === JobStatus.OFFERED),
      ).length,
    };
  });

  // Job-status composition over the same next-7-day window (donut source).
  const statusCounts = new Map<JobStatus, number>();
  for (const row of chartRows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  }
  const statusBreakdown = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return { recentJobs, upcomingSevenDayLoad, statusBreakdown };
}

// Maps a JobStatus to a chart-kit tone for the status donut.
const STATUS_TONE: Record<
  JobStatus,
  "primary" | "accent" | "success" | "warning" | "info" | "destructive"
> = {
  UNASSIGNED: "warning",
  OFFERED: "warning",
  ASSIGNED: "primary",
  EN_ROUTE: "info",
  IN_PROGRESS: "info",
  PAUSED: "info",
  WAITING_CONTINUATION_APPROVAL: "destructive",
  SUBMITTED: "accent",
  QA_REVIEW: "accent",
  COMPLETED: "success",
  INVOICED: "success",
};

const STATUS_COLORS: Record<JobStatus, string> = {
  UNASSIGNED: "warning",
  OFFERED: "warning",
  ASSIGNED: "secondary",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "destructive",
  SUBMITTED: "secondary",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "outline",
} as any;

export default async function AdminDashboard() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const nowForAttention = new Date();
  const next24h = new Date(nowForAttention.getTime() + 24 * 60 * 60 * 1000);
  const cutoff24h = new Date(nowForAttention.getTime() - 24 * 60 * 60 * 1000);
  const cutoff12h = new Date(nowForAttention.getTime() - 12 * 60 * 60 * 1000);

  // Today bounds for the strip (Australia/Sydney)
  const nowSyd = toZonedTime(nowForAttention, TZ);
  const todayStripStart = new Date(
    nowSyd.getFullYear(),
    nowSyd.getMonth(),
    nowSyd.getDate(),
  );
  const todayStripEnd = new Date(todayStripStart.getTime() + 86400_000);

  const [
    metrics,
    chartData,
    urgentItems,
    pendingContinuations,
    pendingTimingRequests,
    pendingPayAdj,
    pendingClientApprovals,
    pendingFlaggedLaundry,
    todaysJobsStrip,
    openCasesOver24h,
    qaPendingOver12h,
    unassignedSoon,
  ] = await Promise.all([
    getDashboardMetrics(),
    getRecentJobs(todayStripStart, todayStripEnd),
    getAdminImmediateAttention(),
    listContinuationRequests({ status: "PENDING" }),
    listEarlyCheckoutRequests({ status: "PENDING" }),
    db.cleanerPayAdjustment.count({
      where: { status: PayAdjustmentStatus.PENDING },
    }),
    listClientApprovals({ status: "PENDING" }),
    db.laundryTask.count({ where: { status: "FLAGGED" } }),
    db.job.findMany({
      where: {
        scheduledDate: { gte: todayStripStart, lt: todayStripEnd },
      },
      orderBy: [{ startTime: "asc" }, { scheduledDate: "asc" }],
      take: 20,
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        property: { select: { name: true, suburb: true } },
        assignments: {
          select: { user: { select: { name: true } } },
          take: 1,
        },
      },
    }),
    db.issueTicket.count({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS"] },
        createdAt: { lt: cutoff24h },
      },
    }),
    db.qaAssignment.count({
      where: { status: "OPEN", createdAt: { lt: cutoff12h } },
    }),
    db.job.count({
      where: {
        status: JobStatus.UNASSIGNED,
        scheduledDate: { gte: nowForAttention, lt: next24h },
      },
    }),
  ]);

  const next48h = new Date(nowForAttention.getTime() + 48 * 60 * 60 * 1000);
  const [
    dispatchRiskJobs,
    auditFeed,
    failedNotifications24h,
    unresolvedUploadFailures,
    failedIcalSyncs24h,
  ] = await Promise.all([
    db.job
      .findMany({
        where: {
          status: { in: [JobStatus.UNASSIGNED, JobStatus.OFFERED] },
          scheduledDate: { gte: nowForAttention, lt: next48h },
        },
        orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
        take: 8,
        select: {
          id: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          startTime: true,
          property: { select: { name: true, suburb: true } },
        },
      })
      .catch(() => []),
    db.auditLog
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      })
      .catch(() => []),
    db.notificationLog
      .count({ where: { status: "FAILED", createdAt: { gte: cutoff24h } } })
      .catch(() => 0),
    db.uploadFailure.count({ where: { resolvedAt: null } }).catch(() => 0),
    db.icalSyncRun
      .count({ where: { status: "FAILED", createdAt: { gte: cutoff24h } } })
      .catch(() => 0),
  ]);

  const continuationJobIds = Array.from(
    new Set(pendingContinuations.map((row) => row.jobId)),
  );
  // Match the approval center: pay-request client approvals are surfaced under
  // Pay Requests, NOT as standalone admin "client approvals", so exclude them
  // here too — otherwise the dashboard over-counts vs the approvals page.
  const adminClientApprovals = pendingClientApprovals.filter((ca) => {
    const meta = ca.metadata as Record<string, unknown> | null;
    return meta?.source !== "pay_adjustment";
  });
  const totalApprovalsCount =
    pendingContinuations.length +
    pendingTimingRequests.length +
    pendingPayAdj +
    adminClientApprovals.length +
    pendingFlaggedLaundry;
  const continuationJobs = continuationJobIds.length
    ? await db.job.findMany({
        where: { id: { in: continuationJobIds } },
        select: {
          id: true,
          jobType: true,
          scheduledDate: true,
          property: { select: { name: true, suburb: true } },
        },
      })
    : [];
  const continuationJobById = new Map(continuationJobs.map((j) => [j.id, j]));

  const newApplicationsCount = await db.hiringApplication
    .count({ where: { status: "NEW" } })
    .catch(() => 0);

  const attentionTotal =
    openCasesOver24h + qaPendingOver12h + unassignedSoon + metrics.lowStockCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-border bg-gradient-to-r from-surface-raised via-surface to-primary/5 p-5 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.5)] dark:shadow-none dark:from-surface-raised dark:via-surface-raised dark:to-primary/10">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Operations Dashboard
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {format(toZonedTime(new Date(), TZ), "EEEE, d MMMM yyyy")} | Live
          operations, dispatch risk, and approval workload.
        </p>
      </div>

      {/* Quick-launch toolbar */}
      <section aria-label="Quick launch">
        <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible md:grid-cols-3 2xl:grid-cols-6">
          {QUICK_LAUNCH.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-sm font-medium text-foreground shadow-sm transition hover:-translate-y-px hover:border-primary/40 hover:bg-surface-raised hover:shadow-md sm:shrink"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary/15">
                <item.icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Approvals banner */}
      {totalApprovalsCount > 0 && (
        <Link
          href="/admin/approvals"
          className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 transition hover:bg-destructive/15"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-destructive" />
            <span className="text-sm font-medium text-destructive">
              {totalApprovalsCount} pending approval
              {totalApprovalsCount !== 1 ? "s" : ""} need your attention
            </span>
            <div className="hidden sm:flex items-center gap-2">
              {pendingContinuations.length > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {pendingContinuations.length} continuation
                  {pendingContinuations.length !== 1 ? "s" : ""}
                </span>
              )}
              {pendingTimingRequests.length > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {pendingTimingRequests.length} timing
                </span>
              )}
              {pendingPayAdj > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {pendingPayAdj} pay
                </span>
              )}
              {adminClientApprovals.length > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {adminClientApprovals.length} client
                </span>
              )}
              {pendingFlaggedLaundry > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {pendingFlaggedLaundry} laundry
                </span>
              )}
            </div>
          </div>
          <span className="text-xs font-semibold text-destructive underline-offset-2 hover:underline">
            Review all →
          </span>
        </Link>
      )}

      {/* New job applications — red, links to the hiring page */}
      {newApplicationsCount > 0 && (
        <Link
          href="/admin/hiring"
          className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 transition hover:bg-destructive/15"
        >
          <div className="flex items-center gap-2.5">
            <UserPlus className="h-4 w-4 shrink-0 text-destructive" />
            <span className="text-sm font-medium text-destructive">
              {newApplicationsCount} new job application{newApplicationsCount !== 1 ? "s" : ""} to review
            </span>
          </div>
          <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-destructive px-2 text-xs font-bold text-white">
            {newApplicationsCount}
          </span>
        </Link>
      )}

      {/* Needs attention banner */}
      {attentionTotal > 0 ? (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="space-y-1 p-4">
            <p className="text-sm font-semibold text-warning">Needs attention</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {openCasesOver24h > 0 ? (
                <li>
                  <Link href="/admin/cases" className="hover:underline">
                    {openCasesOver24h} open case
                    {openCasesOver24h !== 1 ? "s" : ""} &gt; 24h
                  </Link>
                </li>
              ) : null}
              {qaPendingOver12h > 0 ? (
                <li>
                  <Link href="/qa" className="hover:underline">
                    {qaPendingOver12h} QA assignment
                    {qaPendingOver12h !== 1 ? "s" : ""} waiting &gt; 12h
                  </Link>
                </li>
              ) : null}
              {unassignedSoon > 0 ? (
                <li>
                  <Link
                    href="/admin/jobs?status=UNASSIGNED"
                    className="hover:underline"
                  >
                    {unassignedSoon} job{unassignedSoon !== 1 ? "s" : ""}{" "}
                    unassigned in next 24h
                  </Link>
                </li>
              ) : null}
              {metrics.lowStockCount > 0 ? (
                <li>
                  <Link href="/admin/inventory" className="hover:underline">
                    {metrics.lowStockCount} low-stock item
                    {metrics.lowStockCount !== 1 ? "s" : ""}
                  </Link>
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Row 1: headline KPI tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          href="/admin/jobs"
          icon={<DollarSign />}
          tone="success"
          label={`Today's earnings · ${metrics.today.completed} done, ${metrics.today.remaining} to go`}
          value={formatAud(metrics.today.revenueAud)}
        />
        <KpiTile
          href="/admin/workforce"
          icon={<Users />}
          tone="info"
          label={`Cleaners tomorrow · ${metrics.tomorrow.idle} idle`}
          value={
            <span className="tabular-nums">
              {metrics.tomorrow.scheduled}
              <span className="text-muted-foreground">
                /{metrics.tomorrow.total}
              </span>
            </span>
          }
        />
        <KpiTile
          href="/admin/invoices"
          icon={<Receipt />}
          tone={metrics.invoices.outstandingCount > 0 ? "warning" : "neutral"}
          label={`Outstanding · ${metrics.invoices.outstandingCount} unpaid`}
          value={formatAud(metrics.invoices.outstandingAud)}
        />
        <KpiTile
          href="/qa"
          icon={<ClipboardCheck />}
          tone={metrics.qaPending > 0 ? "warning" : "neutral"}
          label="Pending QA inspections"
          value={metrics.qaPending}
        />
      </div>

      {/* Analytics row: 7-day load trend + job-status mix (ops-flavoured) */}
      <OpsAnalyticsRow
        sevenDayLoad={chartData.upcomingSevenDayLoad}
        statusSlices={chartData.statusBreakdown.map((s) => ({
          label: s.status.replace(/_/g, " "),
          value: s.count,
          tone: STATUS_TONE[s.status],
        }))}
        totalUpcoming={chartData.statusBreakdown.reduce(
          (sum, s) => sum + s.count,
          0,
        )}
      />

      {/* Row 2: Top cleaner / Low stock */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-border bg-surface transition hover:bg-surface-raised">
          <Link
            href={
              metrics.topCleaner
                ? `/admin/workforce/performance?cleaner=${metrics.topCleaner.userId}`
                : "/admin/workforce/performance"
            }
            className="block p-5"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Top cleaner · last 7 days
              </p>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <Trophy className="h-4 w-4" />
              </span>
            </div>
            {metrics.topCleaner ? (
              <>
                <p className="mt-3 text-lg font-semibold text-foreground truncate">
                  {metrics.topCleaner.name}
                </p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">
                    {metrics.topCleaner.jobsDone}
                  </span>{" "}
                  jobs
                  {metrics.topCleaner.avgRating !== null && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 fill-warning text-warning" />
                        <span className="font-semibold text-foreground tabular-nums">
                          {metrics.topCleaner.avgRating.toFixed(1)}
                        </span>
                      </span>
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No completed jobs this week yet.
              </p>
            )}
          </Link>
        </Card>

        <KpiTile
          href="/admin/inventory/properties"
          icon={<PackageMinus />}
          tone={metrics.lowStockCount > 0 ? "warning" : "neutral"}
          label={
            metrics.lowStockCount > 0
              ? "Low-stock items · below reorder threshold"
              : "Low-stock items · stock healthy"
          }
          value={metrics.lowStockCount}
        />
      </div>

      {/* Today's jobs strip */}
      {todaysJobsStrip.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Today's jobs
            </h2>
            <Link
              href="/admin/jobs"
              className="text-xs text-primary hover:underline"
            >
              View all jobs →
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {todaysJobsStrip.map((job) => (
              <Link
                key={job.id}
                href={`/admin/jobs/${job.id}`}
                className="block min-w-[240px] flex-shrink-0 rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-raised"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {job.property?.name ?? "Job"}
                  </p>
                  <StatusPill
                    variant={statusToPillVariant(job.status)}
                    size="sm"
                  >
                    {job.status.replace(/_/g, " ")}
                  </StatusPill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {job.startTime ? `${job.startTime} · ` : ""}
                  {job.property?.suburb ?? ""}
                </p>
                <p className="mt-2 text-xs text-foreground">
                  {job.assignments[0]?.user?.name ?? "Unassigned"}
                  {job.jobNumber ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · #{job.jobNumber}
                    </span>
                  ) : null}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Row 3: Live en-route + Recent feedback split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Live en-route */}
        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="relative flex h-2.5 w-2.5">
                {metrics.enRouteCount > 0 && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${metrics.enRouteCount > 0 ? "bg-success" : "bg-muted-foreground/40"}`}
                />
              </span>
              Live en route
            </CardTitle>
            <Link
              href="/admin/ops"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open map <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-4xl font-bold tabular-nums text-foreground">
                {metrics.enRouteCount}
              </p>
              <p className="text-xs text-muted-foreground">
                cleaner{metrics.enRouteCount !== 1 ? "s" : ""} pinged GPS in the
                last 5 minutes
              </p>
            </div>
            <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Navigation className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  Use the live ops map to see ETAs, idle time, and routing
                  exceptions in real time.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent feedback */}
        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Recent feedback · 7d</CardTitle>
            <Link
              href="/admin/jobs?filter=feedback"
              className="text-xs text-primary hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {metrics.recentFeedback.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No client feedback submitted in the past week.
              </p>
            ) : (
              metrics.recentFeedback.map((fb) => (
                <Link
                  key={fb.id}
                  href={`/admin/jobs/${fb.jobId}`}
                  className="block rounded-lg border border-border/60 bg-background/40 p-3 transition hover:border-border hover:bg-surface-raised"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {fb.client?.name ?? "Client"}
                    </span>
                    <span className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3.5 w-3.5 ${
                            i < (fb.rating ?? 0)
                              ? "fill-warning text-warning"
                              : "text-muted-foreground/30"
                          }`}
                          aria-hidden
                        />
                      ))}
                    </span>
                  </div>
                  {fb.comment ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      "{fb.comment}"
                    </p>
                  ) : null}
                  {fb.submittedAt && (
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {format(new Date(fb.submittedAt), "d MMM · HH:mm")}
                    </p>
                  )}
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <ImmediateAttentionPanel
        title="Immediate Attention"
        description="Critical approvals, cases, and dispatch blockers."
        items={urgentItems}
      />

      {/* 7-day schedule strip */}
      <Card className="border-border bg-surface">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4 text-primary" />
            Next 7 days
          </CardTitle>
          <Link href="/admin/calendar" className="text-xs text-primary hover:underline">
            Open calendar →
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {chartData.upcomingSevenDayLoad.map((day, idx) => (
              <Link
                key={day.date}
                href={`/admin/jobs?date=${day.date}`}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition hover:bg-surface-raised ${
                  day.unassigned > 0
                    ? "border-warning/50 bg-warning/5"
                    : "border-border bg-surface"
                }`}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {idx === 0 ? "Today" : day.label}
                </span>
                <span className="text-xl font-bold tabular-nums text-foreground">
                  {day.jobs}
                </span>
                {day.unassigned > 0 ? (
                  <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                    {day.unassigned} open
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">covered</span>
                )}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dispatch risk + System health */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle
                className={`h-4 w-4 ${dispatchRiskJobs.length > 0 ? "text-warning" : "text-muted-foreground"}`}
              />
              Dispatch risk · next 48h
            </CardTitle>
            <Link
              href="/admin/jobs?status=UNASSIGNED"
              className="text-xs text-primary hover:underline"
            >
              All unassigned →
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {dispatchRiskJobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Every job in the next 48 hours has a cleaner assigned.
              </p>
            ) : (
              dispatchRiskJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/admin/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5 transition hover:bg-surface-raised"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {job.property?.name ?? "Job"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(toZonedTime(job.scheduledDate, TZ), "EEE d MMM")}
                      {job.startTime ? ` · ${job.startTime}` : ""}
                      {job.property?.suburb ? ` · ${job.property.suburb}` : ""}
                    </p>
                  </div>
                  <StatusPill variant={statusToPillVariant(job.status)} size="sm">
                    {job.status.replace(/_/g, " ")}
                  </StatusPill>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartPulse
                className={`h-4 w-4 ${
                  failedNotifications24h + unresolvedUploadFailures + failedIcalSyncs24h > 0
                    ? "text-destructive"
                    : "text-success"
                }`}
              />
              System health
            </CardTitle>
            <Link
              href="/admin/system/diagnostics"
              className="text-xs text-primary hover:underline"
            >
              Diagnostics →
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            <HealthRow
              label="Failed notifications · 24h"
              count={failedNotifications24h}
              href="/admin/notifications"
              okText="All notifications delivered"
            />
            <HealthRow
              label="Unresolved upload failures"
              count={unresolvedUploadFailures}
              href="/admin/system/uploads"
              okText="No stuck uploads"
            />
            <HealthRow
              label="Failed calendar syncs · 24h"
              count={failedIcalSyncs24h}
              href="/admin/integrations"
              okText="All iCal feeds syncing"
            />
          </CardContent>
        </Card>
      </div>

      {/* Activity feed */}
      <Card className="border-border bg-surface">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Latest activity
          </CardTitle>
          <Link href="/admin/activity" className="text-xs text-primary hover:underline">
            Full audit log →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {auditFeed.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No audited actions recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {auditFeed.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-6 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      <span className="font-medium">{entry.user?.name ?? "System"}</span>{" "}
                      <span className="text-muted-foreground">
                        {entry.action.replace(/[._]/g, " ").toLowerCase()}
                      </span>{" "}
                      <span className="font-medium">{entry.entity}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {format(toZonedTime(entry.createdAt, TZ), "d MMM HH:mm")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {pendingContinuations.length > 0 ? (
        <Card className="border-warning/40 bg-warning/10">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Pause / Continuation Approvals
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="warning">
                {pendingContinuations.length} pending
              </Badge>
              <Link
                href="/admin/approvals"
                className="text-xs text-primary hover:underline"
              >
                View all approvals →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingContinuations.slice(0, 5).map((row) => {
              const job = continuationJobById.get(row.jobId);
              return (
                <Link
                  key={row.id}
                  href={`/admin/jobs/${row.jobId}`}
                  className="flex items-center justify-between rounded-md border border-warning/40 bg-surface/80 px-4 py-3 transition hover:bg-surface"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {job?.property?.name ?? `Job ${row.jobId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {job?.property?.suburb ? `${job.property.suburb} · ` : ""}
                      {job?.jobType
                        ? `${String(job.jobType).replace(/_/g, " ")} · `
                        : ""}
                      {job?.scheduledDate
                        ? `${format(new Date(job.scheduledDate), "dd MMM yyyy")} · `
                        : ""}
                      Requested{" "}
                      {format(new Date(row.requestedAt), "dd MMM HH:mm")}
                      {row.preferredDate ? ` · Prefers ${row.preferredDate}` : ""}
                    </p>
                    <p className="mt-1 text-xs">{row.reason}</p>
                  </div>
                  <Badge variant="destructive">Waiting Approval</Badge>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* Recent Jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Jobs</CardTitle>
          <Link
            href="/admin/jobs"
            className="text-sm text-primary hover:underline"
          >
            View all →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {chartData.recentJobs.map((job) => (
              <Link
                key={job.id}
                href={`/admin/jobs/${job.id}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{job.property.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.property.suburb} · {job.jobType.replace(/_/g, " ")} ·{" "}
                    {format(toZonedTime(job.scheduledDate, TZ), "dd MMM")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {job.assignments[0] && (
                    <span className="text-xs text-muted-foreground hidden sm:block">
                      {job.assignments[0].user.name}
                    </span>
                  )}
                  <Badge
                    variant={(STATUS_COLORS[job.status] ?? "outline") as any}
                  >
                    {job.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </Link>
            ))}
            {chartData.recentJobs.length === 0 && (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No jobs yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Local primitives
// ─────────────────────────────────────────────────────────

function HealthRow({
  label,
  count,
  href,
  okText,
}: {
  label: string;
  count: number;
  href: string;
  okText: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition hover:bg-surface-raised ${
        count > 0 ? "border-destructive/40 bg-destructive/5" : "border-border bg-background/40"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          {count > 0 ? "Needs investigation" : okText}
        </p>
      </div>
      <span
        className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums ${
          count > 0
            ? "bg-destructive/15 text-destructive"
            : "bg-success/10 text-success"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}
