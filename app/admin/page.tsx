import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role, JobStatus } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, AlertTriangle, Package, Shirt, Calendar } from "lucide-react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Link from "next/link";
import { getAppSettings } from "@/lib/settings";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { getAdminImmediateAttention } from "@/lib/dashboard/immediate-attention";

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
    lowStockCount,
    activeSlaJobs,
    recentJobs,
  ] = await Promise.all([
    db.job.count({ where: { scheduledDate: { gte: todayStart, lt: todayEnd } } }),
    db.job.count({ where: { status: JobStatus.UNASSIGNED } }),
    db.laundryTask.count({ where: { status: "FLAGGED" } }),
    db.propertyStock.count({ where: { onHand: { lte: db.propertyStock.fields.reorderThreshold } } }),
    db.job.findMany({
      where: {
        status: { in: [JobStatus.UNASSIGNED, JobStatus.ASSIGNED, JobStatus.IN_PROGRESS, JobStatus.SUBMITTED, JobStatus.QA_REVIEW] },
        dueTime: { not: null },
        scheduledDate: { lte: todayEnd },
      },
      select: { id: true, scheduledDate: true, dueTime: true },
      take: 500,
    }),
    db.job.findMany({
      take: 10,
      orderBy: { scheduledDate: "desc" },
      include: {
        property: { select: { name: true, suburb: true } },
        assignments: { include: { user: { select: { name: true } } } },
      },
    }),
  ]);

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

  return { todayJobs, unassignedJobs, flaggedLaundry, lowStockCount, slaDueSoon, slaOverdue, recentJobs };
}

const STATUS_COLORS: Record<JobStatus, string> = {
  UNASSIGNED: "warning",
  ASSIGNED: "secondary",
  IN_PROGRESS: "default",
  SUBMITTED: "secondary",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "outline",
} as any;

export default async function AdminDashboard() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [stats, urgentItems] = await Promise.all([
    getDashboardStats(),
    getAdminImmediateAttention(),
  ]);

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

      {/* Recent Jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Jobs</CardTitle>
          <Link href="/admin/jobs" className="text-sm text-primary hover:underline">View all →</Link>
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
