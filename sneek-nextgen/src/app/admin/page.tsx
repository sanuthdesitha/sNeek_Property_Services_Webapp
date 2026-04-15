import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, DollarSign, Users, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { prisma } from "@/lib/db/prisma";

async function getDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [jobsToday, totalJobs, activeCleaners, pendingApprovals, revenueMTD] = await Promise.all([
    prisma.job.count({ where: { scheduledDate: { gte: today, lt: tomorrow } } }),
    prisma.job.count(),
    prisma.user.count({ where: { role: "CLEANER", isActive: true } }),
    0,
    prisma.clientInvoice.aggregate({
      where: { status: "PAID", createdAt: { gte: new Date(today.getFullYear(), today.getMonth(), 1) } },
      _sum: { totalAmount: true },
    }),
  ]);

  return { jobsToday, totalJobs, activeCleaners, pendingApprovals, revenueMTD: revenueMTD._sum.totalAmount ?? 0 };
}

async function getRecentActivity() {
  const recentJobs = await prisma.job.findMany({
    take: 5,
    orderBy: { updatedAt: "desc" },
    include: { property: { select: { name: true } } },
  });
  return { recentJobs };
}

export default async function AdminDashboard() {
  const stats = await getDashboardStats();
  const activity = await getRecentActivity();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Overview of your operations</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="outlined">
          <div className="flex items-start justify-between p-4">
            <div>
              <p className="text-sm text-text-secondary">Jobs Today</p>
              <p className="text-2xl font-bold mt-1">{stats.jobsToday}</p>
              <p className="text-xs text-text-tertiary mt-1">{stats.totalJobs} total jobs</p>
            </div>
            <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800"><Briefcase className="h-5 w-5 text-text-secondary" /></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-start justify-between p-4">
            <div>
              <p className="text-sm text-text-secondary">Revenue (MTD)</p>
              <p className="text-2xl font-bold mt-1">${stats.revenueMTD.toLocaleString()}</p>
              <p className="text-xs text-text-tertiary mt-1">Paid invoices this month</p>
            </div>
            <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800"><DollarSign className="h-5 w-5 text-text-secondary" /></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-start justify-between p-4">
            <div>
              <p className="text-sm text-text-secondary">Active Cleaners</p>
              <p className="text-2xl font-bold mt-1">{stats.activeCleaners}</p>
              <p className="text-xs text-text-tertiary mt-1">On duty today</p>
            </div>
            <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800"><Users className="h-5 w-5 text-text-secondary" /></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-start justify-between p-4">
            <div>
              <p className="text-sm text-text-secondary">Pending Approvals</p>
              <p className="text-2xl font-bold mt-1">{stats.pendingApprovals}</p>
              <p className="text-xs text-text-tertiary mt-1">Need your action</p>
            </div>
            <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800"><AlertTriangle className="h-5 w-5 text-text-secondary" /></div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="outlined">
          <CardHeader><CardTitle className="text-base">Daily Briefing</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-text-secondary"><Clock className="h-4 w-4 text-text-tertiary" /><span>{stats.jobsToday} jobs scheduled today</span></div>
              <div className="flex items-center gap-2 text-sm text-text-secondary"><CheckCircle className="h-4 w-4 text-text-tertiary" /><span>{stats.totalJobs} total jobs in system</span></div>
              <div className="flex items-center gap-2 text-sm text-text-secondary"><Users className="h-4 w-4 text-text-tertiary" /><span>{stats.activeCleaners} active cleaners</span></div>
              <div className="flex items-center gap-2 text-sm text-text-secondary"><AlertTriangle className="h-4 w-4 text-text-tertiary" /><span>{stats.pendingApprovals} pending approvals</span></div>
            </div>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activity.recentJobs.length > 0 ? activity.recentJobs.map((job) => (
                <div key={job.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text-primary">Job {job.jobNumber ?? job.id.slice(0, 8)}</p>
                    <p className="text-xs text-text-tertiary">{job.jobType} — {job.property?.name ?? "Unknown"}</p>
                  </div>
                  <Badge variant={job.status === "COMPLETED" ? "success" : "warning"}>{job.status.replace(/_/g, " ")}</Badge>
                </div>
              )) : <p className="text-sm text-text-tertiary">No recent activity</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
