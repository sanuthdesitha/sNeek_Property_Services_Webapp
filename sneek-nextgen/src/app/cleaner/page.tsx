import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Clock, MapPin, CheckCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";

async function getCleanerStats(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [jobsToday, completedJobs, totalEstHours] = await Promise.all([
    prisma.jobAssignment.count({
      where: { userId, job: { scheduledDate: { gte: today, lt: tomorrow } } },
    }),
    prisma.jobAssignment.count({
      where: { userId, responseStatus: "COMPLETED" as const },
    }),
    prisma.job.findMany({
      where: { assignments: { some: { userId, job: { scheduledDate: { gte: today, lt: tomorrow } } } } },
      select: { estHours: true },
    }),
  ]);

  const totalHours = totalEstHours.reduce((sum, j) => sum + (j.estHours ?? 0), 0);

  return { jobsToday, completedJobs, totalHours };
}

async function getTodayJobs(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const assignments = await prisma.jobAssignment.findMany({
    where: {
      userId,
      job: { scheduledDate: { gte: today, lt: tomorrow } },
    },
    include: {
      job: {
        include: {
          property: { select: { name: true, address: true, suburb: true, bedrooms: true, bathrooms: true } },
        },
      },
    },
    orderBy: { job: { scheduledDate: "asc" } },
  });

  return assignments.map((a) => ({
    ...a.job,
    assignmentStatus: a.responseStatus,
  }));
}

export default async function CleanerDashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const stats = await getCleanerStats(session.user.id);
  const jobs = await getTodayJobs(session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Welcome back! Here&apos;s your schedule for today.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-brand-100 dark:bg-brand-900/30"><Briefcase className="h-5 w-5 text-brand-600" /></div>
            <div><p className="text-sm text-text-secondary">Jobs Today</p><p className="text-2xl font-bold">{stats.jobsToday}</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-success-50 dark:bg-success-900/30"><CheckCircle className="h-5 w-5 text-success-600" /></div>
            <div><p className="text-sm text-text-secondary">Completed</p><p className="text-2xl font-bold">{stats.completedJobs}</p></div>
          </div>
        </Card>
        <Card variant="outlined">
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-warning-50 dark:bg-warning-900/30"><Clock className="h-5 w-5 text-warning-600" /></div>
            <div><p className="text-sm text-text-secondary">Est. Hours Today</p><p className="text-2xl font-bold">{stats.totalHours}</p></div>
          </div>
        </Card>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s Jobs</CardTitle>
          <CardDescription>{jobs.length} jobs scheduled</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length > 0 ? (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-center gap-4 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <Badge variant={job.assignmentStatus === "COMPLETED" as const ? "success" : job.assignmentStatus === "ACCEPTED" ? "info" : "neutral"}>
                    {job.assignmentStatus.replace(/_/g, " ")}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{job.jobType.replace(/_/g, " ")}</p>
                    <div className="flex items-center gap-3 text-xs text-text-tertiary">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{job.scheduledDate?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.property?.address}, {job.property?.suburb}</span>
                      <span>{job.property?.bedrooms} bed / {job.property?.bathrooms} bath</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary text-center py-8">No jobs scheduled for today</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
