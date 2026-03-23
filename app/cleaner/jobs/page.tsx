import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { JobStatus, Role } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { compareJobsByPriority } from "@/lib/jobs/priority";

const TZ = "Australia/Sydney";

const STATUS_BADGE: Record<string, any> = {
  UNASSIGNED: "warning",
  ASSIGNED: "secondary",
  IN_PROGRESS: "default",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "destructive",
  SUBMITTED: "default",
  QA_REVIEW: "warning",
  COMPLETED: "success",
  INVOICED: "outline",
};

const FILTERABLE_STATUSES = [
  "ALL",
  ...Object.values(JobStatus),
] as const;

function parseDateValue(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function CleanerJobsPage({
  searchParams,
}: {
  searchParams?: {
    status?: string;
    scope?: string;
    from?: string;
    to?: string;
    q?: string;
  };
}) {
  const session = await requireRole([Role.CLEANER]);

  const statusRaw = (searchParams?.status ?? "ALL").toUpperCase();
  const status = FILTERABLE_STATUSES.includes(statusRaw as any)
    ? (statusRaw as (typeof FILTERABLE_STATUSES)[number])
    : "ALL";
  const scope = (searchParams?.scope ?? "all").toLowerCase();
  const q = (searchParams?.q ?? "").trim();
  const from = parseDateValue(searchParams?.from);
  const to = parseDateValue(searchParams?.to);
  const toEnd = to ? new Date(`${searchParams?.to}T23:59:59.999`) : undefined;
  const now = new Date();

  const where: any = {
    assignments: { some: { userId: session.user.id } },
  };

  if (status !== "ALL") where.status = status;
  if (from || toEnd) {
    where.scheduledDate = {
      ...(from ? { gte: from } : {}),
      ...(toEnd ? { lte: toEnd } : {}),
    };
  }
  if (scope === "completed") {
    where.status = status === "ALL" ? { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] } : where.status;
  } else if (scope === "upcoming") {
    where.scheduledDate = {
      ...(where.scheduledDate ?? {}),
      gte: (where.scheduledDate?.gte && where.scheduledDate.gte > now) ? where.scheduledDate.gte : now,
    };
  }
  if (q) {
    where.OR = [
      { property: { name: { contains: q, mode: "insensitive" } } },
      { property: { suburb: { contains: q, mode: "insensitive" } } },
    ];
  }

  const jobs = await db.job.findMany({
    where,
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      status: true,
      scheduledDate: true,
      startTime: true,
      dueTime: true,
      priorityBucket: true,
      priorityReason: true,
      internalNotes: true,
      property: { select: { name: true, suburb: true, address: true } },
      report: { select: { id: true } },
      assignments: {
        where: { userId: session.user.id },
        select: { payRate: true },
        take: 1,
      },
    },
    orderBy: [
      { scheduledDate: "asc" },
      { priorityBucket: "asc" },
      { dueTime: "asc" },
      { startTime: "asc" },
    ],
    take: 300,
  });

  const sortedJobs = [...jobs].sort((left, right) => {
    const leftTime = new Date(left.scheduledDate).getTime();
    const rightTime = new Date(right.scheduledDate).getTime();

    if (scope === "completed") {
      return rightTime - leftTime;
    }

    if (scope === "upcoming") {
      return leftTime - rightTime;
    }

    const leftIsUpcoming = leftTime >= now.getTime();
    const rightIsUpcoming = rightTime >= now.getTime();

    if (leftIsUpcoming !== rightIsUpcoming) {
      return leftIsUpcoming ? -1 : 1;
    }

    if (leftIsUpcoming) {
      return compareJobsByPriority(left, right);
    }

    return rightTime - leftTime;
  });

  const total = sortedJobs.length;
  const completedCount = sortedJobs.filter((j) => ["COMPLETED", "INVOICED"].includes(j.status)).length;
  const activeCount = sortedJobs.filter((j) => ["ASSIGNED", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"].includes(j.status)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">My Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Filter and review all assigned jobs, including completed history.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/cleaner">Dashboard</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/cleaner/jobs?scope=completed">Completed History</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Scope</label>
              <select name="scope" defaultValue={scope} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="all">All</option>
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed / Submitted</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Status</label>
              <select name="status" defaultValue={status} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {FILTERABLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === "ALL" ? "All statuses" : s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <input type="date" name="from" defaultValue={searchParams?.from ?? ""} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input type="date" name="to" defaultValue={searchParams?.to ?? ""} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Property / suburb</label>
              <input type="text" name="q" defaultValue={q} placeholder="Search" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
              <Button type="submit" size="sm">Apply filters</Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href="/cleaner/jobs">Reset</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Loaded jobs</p>
            <p className="text-2xl font-bold">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Completed / invoiced</p>
            <p className="text-2xl font-bold">{completedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active / paused</p>
            <p className="text-2xl font-bold">{activeCount}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="p-0">
          {sortedJobs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No jobs matched your filters.</p>
          ) : (
            <div className="divide-y">
              {sortedJobs.map((job) => {
                const timingHighlights = [
                  ...getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)),
                  ...(job.priorityReason ? [job.priorityReason] : []),
                ];
                return (
                  <div key={job.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/cleaner/jobs/${job.id}`} className="truncate font-medium hover:underline">
                          {job.property.name}
                        </Link>
                        {job.jobNumber ? (
                          <Badge
                            variant="warning"
                            className="border-amber-300 bg-amber-100 text-[10px] font-semibold uppercase tracking-wide text-amber-950"
                          >
                            {job.jobNumber}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {job.property.suburb} - {job.jobType.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(toZonedTime(job.scheduledDate, TZ), "EEE dd MMM yyyy")}
                        {job.startTime ? ` | ${job.startTime}` : ""}
                        {job.dueTime ? ` - ${job.dueTime}` : ""}
                      </p>
                      {timingHighlights.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {timingHighlights.map((line) => (
                            <Badge key={`${job.id}-${line}`} variant="warning">
                              {line}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_BADGE[job.status] ?? "secondary"}>
                        {job.status.replace(/_/g, " ")}
                      </Badge>
                      {job.report ? (
                        <Button size="sm" variant="outline" asChild>
                          <a href={`/api/reports/${job.id}/download`}>Report PDF</a>
                        </Button>
                      ) : null}
                      <Button size="sm" asChild>
                        <Link href={`/cleaner/jobs/${job.id}`}>Open job</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
