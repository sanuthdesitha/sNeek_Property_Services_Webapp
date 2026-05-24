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
} from "lucide-react";
import { addDays, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Link from "next/link";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { getAdminImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { AdminDashboardGraphs } from "@/components/admin/admin-dashboard-graphs";
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
          scheduledDate: {
            gte: new Date(todayStart.getTime() - 30 * 86400_000),
            lt: addDays(todayEnd, 7),
          },
        },
        select: { status: true, scheduledDate: true, jobType: true },
        take: 2000,
        orderBy: { scheduledDate: "asc" },
      }),
    ]);

  const recentJobs = [
    ...todaysRecentJobs,
    ...upcomingRecentJobs,
    ...recentPastJobs,
  ].slice(0, 10);

  const jobsByStatus = Object.values(JobStatus).map((status) => ({
    label: status.replace(/_/g, " "),
    value: chartRows.filter((row) => row.status === status).length,
  }));

  const upcomingSevenDayLoad = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(todayStart, index);
    const key = day.toISOString().slice(0, 10);
    const label = format(day, "EEE");
    return {
      date: key,
      label,
      jobs: chartRows.filter(
        (row) => row.scheduledDate.toISOString().slice(0, 10) === key,
      ).length,
    };
  });

  const jobTypeBreakdown = Array.from(
    chartRows.reduce<Map<string, number>>((acc, row) => {
      const key = row.jobType.replace(/_/g, " ");
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>()),
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return { recentJobs, jobsByStatus, upcomingSevenDayLoad, jobTypeBreakdown };
}

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

  const continuationJobIds = Array.from(
    new Set(pendingContinuations.map((row) => row.jobId)),
  );
  const totalApprovalsCount =
    pendingContinuations.length +
    pendingTimingRequests.length +
    pendingPayAdj +
    pendingClientApprovals.length +
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
        <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible md:grid-cols-6">
          {QUICK_LAUNCH.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex min-w-[140px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-sm font-medium text-foreground shadow-sm transition hover:-translate-y-px hover:border-primary/40 hover:bg-surface-raised hover:shadow-md"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary/15">
                <item.icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="truncate">{item.label}</span>
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
              {pendingClientApprovals.length > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {pendingClientApprovals.length} client
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
                  <Link href="/admin/qa" className="hover:underline">
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

      {/* Row 1: Revenue / Tomorrow availability / Outstanding invoices */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DashboardStatCard
          href="/admin/jobs"
          icon={<DollarSign className="h-4 w-4" />}
          accent="success"
          label="Today's earnings"
          value={formatAud(metrics.today.revenueAud)}
          sublabel={
            <>
              <span className="font-semibold text-foreground tabular-nums">
                {metrics.today.completed}
              </span>{" "}
              done ·{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {metrics.today.remaining}
              </span>{" "}
              still scheduled
            </>
          }
        />
        <DashboardStatCard
          href="/admin/workforce"
          icon={<Users className="h-4 w-4" />}
          accent="info"
          label="Cleaners tomorrow"
          value={
            <span className="tabular-nums">
              {metrics.tomorrow.scheduled}
              <span className="text-muted-foreground">
                /{metrics.tomorrow.total}
              </span>
            </span>
          }
          sublabel={
            <>
              <span className="font-semibold text-foreground tabular-nums">
                {metrics.tomorrow.idle}
              </span>{" "}
              idle and available
            </>
          }
        />
        <DashboardStatCard
          href="/admin/invoices"
          icon={<Receipt className="h-4 w-4" />}
          accent={metrics.invoices.outstandingCount > 0 ? "warning" : "neutral"}
          label="Outstanding invoices"
          value={formatAud(metrics.invoices.outstandingAud)}
          sublabel={
            <>
              <span className="font-semibold text-foreground tabular-nums">
                {metrics.invoices.outstandingCount}
              </span>{" "}
              awaiting payment
            </>
          }
        />
      </div>

      {/* Row 2: Top cleaner / Pending QA / Low stock */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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

        <DashboardStatCard
          href="/qa"
          icon={<ClipboardCheck className="h-4 w-4" />}
          accent={metrics.qaPending > 0 ? "warning" : "neutral"}
          label="Pending QA inspections"
          value={metrics.qaPending}
          sublabel={
            metrics.qaPending > 0
              ? "Open or assigned reviews"
              : "All caught up"
          }
        />

        <DashboardStatCard
          href="/admin/inventory/properties"
          icon={<PackageMinus className="h-4 w-4" />}
          accent={metrics.lowStockCount > 0 ? "warning" : "neutral"}
          label="Low-stock items"
          value={metrics.lowStockCount}
          sublabel={
            metrics.lowStockCount > 0
              ? "Below reorder threshold"
              : "Stock levels healthy"
          }
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

      <AdminDashboardGraphs
        jobsByStatus={chartData.jobsByStatus}
        upcomingSevenDayLoad={chartData.upcomingSevenDayLoad}
        jobTypeBreakdown={chartData.jobTypeBreakdown}
      />

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

type Accent = "success" | "warning" | "info" | "neutral";

const ACCENT_STYLES: Record<Accent, { icon: string; ring: string }> = {
  success: {
    icon: "bg-success/10 text-success",
    ring: "hover:border-success/40",
  },
  warning: {
    icon: "bg-warning/10 text-warning",
    ring: "hover:border-warning/40",
  },
  info: {
    icon: "bg-primary/10 text-primary",
    ring: "hover:border-primary/40",
  },
  neutral: {
    icon: "bg-muted text-muted-foreground",
    ring: "hover:border-border",
  },
};

function DashboardStatCard({
  href,
  icon,
  label,
  value,
  sublabel,
  accent = "neutral",
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  accent?: Accent;
}) {
  const styles = ACCENT_STYLES[accent];
  return (
    <Card className={`border-border bg-surface transition ${styles.ring}`}>
      <Link href={href} className="block p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles.icon}`}
          >
            {icon}
          </span>
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">
          {value}
        </p>
        {sublabel ? (
          <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
        ) : null}
      </Link>
    </Card>
  );
}
