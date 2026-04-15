import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Home, Clock, CheckCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";

async function getClientStats(clientId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [upcomingCleans, completedThisMonth, propertyCount] = await Promise.all([
    prisma.job.count({
      where: {
        property: { clientId },
        scheduledDate: { gte: today },
        status: { not: "COMPLETED" },
      },
    }),
    prisma.job.count({
      where: {
        property: { clientId },
        status: "COMPLETED",
        createdAt: { gte: new Date(today.getFullYear(), today.getMonth(), 1) },
      },
    }),
    prisma.property.count({ where: { clientId } }),
  ]);

  return { upcomingCleans, completedThisMonth, propertyCount };
}

async function getUpcomingJobs(clientId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const jobs = await prisma.job.findMany({
    where: {
      property: { clientId },
      scheduledDate: { gte: today },
      status: { not: "COMPLETED" },
    },
    include: {
      property: { select: { name: true } },
    },
    take: 5,
    orderBy: { scheduledDate: "asc" },
  });

  return jobs;
}

export default async function ClientDashboard() {
  const session = await auth();
  if (!session?.user?.clientId) redirect("/login");

  const stats = await getClientStats(session.user.clientId);
  const upcomingJobs = await getUpcomingJobs(session.user.clientId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Welcome back! Here&apos;s an overview of your services.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-brand-100 dark:bg-brand-900/30"><Calendar className="h-5 w-5 text-brand-600" /></div>
            <div><p className="text-sm text-text-secondary">Upcoming Cleans</p><p className="text-2xl font-bold">{stats.upcomingCleans}</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-success-50 dark:bg-success-900/30"><CheckCircle className="h-5 w-5 text-success-600" /></div>
            <div><p className="text-sm text-text-secondary">Completed This Month</p><p className="text-2xl font-bold">{stats.completedThisMonth}</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-info-50 dark:bg-info-900/30"><Home className="h-5 w-5 text-info-600" /></div>
            <div><p className="text-sm text-text-secondary">Properties</p><p className="text-2xl font-bold">{stats.propertyCount}</p></div>
          </div>
        </Card>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Upcoming Jobs</CardTitle>
          <CardDescription>Your next scheduled cleaning services</CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingJobs.length > 0 ? (
            <div className="space-y-3">
              {upcomingJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <Badge variant={job.status === "ASSIGNED" ? "success" : "warning"}>
                    {job.status.replace(/_/g, " ")}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{job.jobType.replace(/_/g, " ")}</p>
                    <div className="flex items-center gap-3 text-xs text-text-tertiary">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{job.scheduledDate?.toLocaleDateString()}</span>
                      <span className="flex items-center gap-1"><Home className="h-3 w-3" />{job.property?.name}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary text-center py-8">No upcoming jobs scheduled</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
