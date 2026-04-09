import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role, JobStatus, PayAdjustmentStatus } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, AlertTriangle, Package, Shirt, Calendar, CheckCircle2 } from "lucide-react";
import { addDays, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Link from "next/link";
import { getAppSettings } from "@/lib/settings";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { getAdminImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { listEarlyCheckoutRequests } from "@/lib/jobs/early-checkout-requests";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { AdminDashboardGraphs } from "@/components/admin/admin-dashboard-graphs";

const TZ = "Australia/Sydney";

function parseDueDateTime(scheduledDate: Date, dueTime: string | null | undefined) {
  if (!dueTime || !/^\d{2}:\d{2}$/.test(dueTime)) return null;
  const [h, m] = dueTime.split(":").map((value) => Number(value));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return new Date(
    Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate(),
      h,
      m,
      0,
      0
    )
  );
}

async function getDashboardStats() {
  const now = toZonedTime(new Date(), TZ);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400_000);
  const settings = await getAppSettings();

  const [
    todayJobs,
    unassignedJobs,
    flaggedLaundry,
    lowStockRows,
    activeSlaJobs,
    todaysRecentJobs,
    upcomingRecentJobs,
    recentPastJobs,
    chartRows,
  ] = await Promise.all([
    db.job.count({ where: { scheduledDate: { gte: todayStart, lt: todayEnd } } }),
    db.job.count({ where: { status: JobStatus.UNASSIGNED } }),
    db.laundryTask.count({ where: { status: "FLAGGED" } }),
    db.propertyStock.findMany({
      select: { onHand: true, reorderThreshold: true },
    }),
    db.job.findMany({
      where: {
        status: {
          in: [
            JobStatus.UNASSIGNED,
            JobStatus.OFFERED,
            JobStatus.ASSIGNED,
            JobStatus.IN_PROGRESS,
            JobStatus.PAUSED,
            JobStatus.WAITING_CONTINUATION_APPROVAL,
            JobStatus.SUBMITTED,
            JobStatus.QA_REVIEW,
          ],
        },
        dueTime: { not: null },
        scheduledDate: { lte: todayEnd },
      },
      select: { id: true, scheduledDate: true, dueTime: true },
      take: 500,
    }),
    db.job.findMany({
      where: {
        scheduledDate: { gte: todayStart, lt: todayEnd },
      },
      take: 10,
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
      where: {
        scheduledDate: { gte: todayEnd },
      },
      take: 10,
      orderBy: [
        { scheduledDate: "asc" },
        { priorityBucket: "asc" },
        { startTime: "asc" },
        { dueTime: "asc" },
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
      where: {
        scheduledDate: { lt: todayStart },
      },
      take: 10,
      orderBy: [
        { scheduledDate: "desc" },
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
      where: {
        scheduledDate: {
          gte: new Date(todayStart.getTime() - 30 * 86400_000),
          lt: addDays(todayEnd, 7),
        },
      },
      select: {
        status: true,
        scheduledDate: true,
        jobType: true,
      },
      take: 2000,
      orderBy: { scheduledDate: "asc" },
    }),
  ]);

  const recentJobs = [...todaysRecentJobs, ...upcomingRecentJobs, ...recentPastJobs].slice(0, 10);

  const lowStockCount = lowStockRows.filter((row) => row.onHand <= row.reorderThreshold).length;

  const nowUtc = new Date();
  let slaDueSoon = 0;
  let slaOverdue = 0;
  for (const job of activeSlaJobs) {
    const dueAt = parseDueDateTime(job.scheduledDate, job.dueTime);
    if (!dueAt) continue;
    const minsToDue = Math.round((dueAt.getTime() - nowUtc.getTime()) / 60_000);
    const minsOverdue = Math.round((nowUtc.getTime() - dueAt.getTime()) / 60_000);
    if (minsOverdue >= settings.sla.overdueEscalationMinutes) {
      slaOverdue += 1;
      continue;
    }
    if (minsToDue > 0 && minsToDue <= settings.sla.warnHoursBeforeDue * 60) {
      slaDueSoon += 1;
    }
  }

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
      jobs: chartRows.filter((row) => row.scheduledDate.toISOString().slice(0, 10) === key).length,
    };
  });

  const jobTypeBreakdown = Array.from(
    chartRows.reduce<Map<string, number>>((acc, row) => {
      const key = row.jobType.replace(/_/g, " ");
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return {
    todayJobs,
    unassignedJobs,
    flaggedLaundry,
    lowStockCount,
    slaDueSoon,
    slaOverdue,
    recentJobs,
    jobsByStatus,
    upcomingSevenDayLoad,
    jobTypeBreakdown,
  };
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
  const [stats, urgentItems, pendingContinuations, pendingTimingRequests, pendingPayAdj, pendingClientApprovals, pendingFlaggedLaundry] = await Promise.all([
    getDashboardStats(),
    getAdminImmediateAttention(),
    listContinuationRequests({ status: "PENDING" }),
    listEarlyCheckoutRequests({ status: "PENDING" }),
    db.cleanerPayAdjustment.count({ where: { status: PayAdjustmentStatus.PENDING } }),
    listClientApprovals({ status: "PENDING" }),
    db.laundryTask.count({ where: { status: "FLAGGED" } }),
  ]);
  const continuationJobIds = Array.from(new Set(pendingContinuations.map((row) => row.jobId)));

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
  const continuationJobById = new Map(continuationJobs.map((job) => [job.id, job]));

  const statCards = [
    { label: "Today's Jobs", value: stats.todayJobs, icon: Calendar, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Unassigned", value: stats.unassignedJobs, icon: Briefcase, color: "text-orange-600", bg: "bg-orange-50", alert: stats.unassignedJobs > 0 },
    { label: "Laundry Flags", value: stats.flaggedLaundry, icon: Shirt, color: "text-red-600", bg: "bg-red-50", alert: stats.flaggedLaundry > 0 },
    { label: "Low Stock Items", value: stats.lowStockCount, icon: Package, color: "text-yellow-600", bg: "bg-yellow-50", alert: stats.lowStockCount > 0 },
    { label: "SLA Due Soon", value: stats.slaDueSoon, icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", alert: stats.slaDueSoon > 0 },
    { label: "SLA Overdue", value: stats.slaOverdue, icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-50", alert: stats.slaOverdue > 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted-foreground text-sm">
          {format(toZonedTime(new Date(), TZ), "EEEE, d MMMM yyyy")}
        </p>
      </div>

      {/* Approvals banner */}
      {totalApprovalsCount > 0 && (
        <Link
          href="/admin/approvals"
          className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 transition hover:bg-destructive/15"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-destructive" />
            <span className="text-sm font-medium text-destructive">
              {totalApprovalsCount} pending approval{totalApprovalsCount !== 1 ? "s" : ""} need your attention
            </span>
            <div className="hidden sm:flex items-center gap-2">
              {pendingContinuations.length > 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  {pendingContinuations.length} continuation{pendingContinuations.length !== 1 ? "s" : ""}
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

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
        {statCards.map((card) => (
          <Card key={card.label} className={card.alert ? "border-orange-200" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
              <div className={`h-8 w-8 rounded-full ${card.bg} flex items-center justify-center`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{card.value}</div>
              {card.alert && card.value > 0 && (
                <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Needs attention
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ImmediateAttentionPanel
        title="Immediate Attention"
        description="Critical approvals, cases, and dispatch blockers."
        items={urgentItems}
      />

      <AdminDashboardGraphs
        jobsByStatus={stats.jobsByStatus}
        upcomingSevenDayLoad={stats.upcomingSevenDayLoad}
        jobTypeBreakdown={stats.jobTypeBreakdown}
      />

      {pendingContinuations.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Pause / Continuation Approvals</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="warning">{pendingContinuations.length} pending</Badge>
              <Link href="/admin/approvals" className="text-xs text-primary hover:underline">View all approvals →</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingContinuations.slice(0, 5).map((row) => {
              const job = continuationJobById.get(row.jobId);
              return (
                <Link
                  key={row.id}
                  href={`/admin/jobs/${row.jobId}`}
                  className="flex items-center justify-between rounded-md border border-amber-300 bg-white/80 px-4 py-3 transition hover:bg-white"
                >
                  <div>
                    <p className="text-sm font-medium">{job?.property?.name ?? `Job ${row.jobId}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {job?.property?.suburb ? `${job.property.suburb} · ` : ""}
                      {job?.jobType ? `${String(job.jobType).replace(/_/g, " ")} · ` : ""}
                      {job?.scheduledDate ? `${format(new Date(job.scheduledDate), "dd MMM yyyy")} · ` : ""}
                      Requested {format(new Date(row.requestedAt), "dd MMM HH:mm")}
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
          <Link href="/admin/jobs" className="text-sm text-primary hover:underline">View all â†’</Link>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {stats.recentJobs.map((job) => (
              <Link
                key={job.id}
                href={`/admin/jobs/${job.id}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{job.property.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.property.suburb} Â· {job.jobType.replace(/_/g, " ")} Â·{" "}
                    {format(toZonedTime(job.scheduledDate, TZ), "dd MMM")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {job.assignments[0] && (
                    <span className="text-xs text-muted-foreground hidden sm:block">
                      {job.assignments[0].user.name}
                    </span>
                  )}
                  <Badge variant={(STATUS_COLORS[job.status] ?? "outline") as any}>
                    {job.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </Link>
            ))}
            {stats.recentJobs.length === 0 && (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">No jobs yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
