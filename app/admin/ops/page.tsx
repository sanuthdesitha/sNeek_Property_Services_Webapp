import Link from "next/link";
import { addDays, format, subHours } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { JobStatus, Role } from "@prisma/client";
import { AlertTriangle, ClipboardList, MapPinned, Route, ShieldAlert, Shirt } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
import { getAdminImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { LiveCleanerLayer } from "@/components/admin/live-cleaner-layer";

const TZ = "Australia/Sydney";

function startOfTodaySydney() {
  const now = toZonedTime(new Date(), TZ);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toneForSeverity(severity: string | null | undefined) {
  const normalized = String(severity ?? "").toUpperCase();
  if (normalized === "CRITICAL") return "destructive" as const;
  if (normalized === "HIGH") return "warning" as const;
  return "secondary" as const;
}

function statusBadgeVariant(status: string | null | undefined) {
  const normalized = String(status ?? "").toUpperCase();
  if (["FLAGGED", "WAITING_CONTINUATION_APPROVAL"].includes(normalized)) return "destructive" as const;
  if (["UNASSIGNED", "QA_REVIEW", "PAUSED"].includes(normalized)) return "warning" as const;
  return "secondary" as const;
}

export default async function OpsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const todayStart = startOfTodaySydney();
  const tomorrowStart = addDays(todayStart, 1);
  const dayAfterTomorrowStart = addDays(todayStart, 2);
  const now = new Date();
  const staleCaseCutoff = subHours(now, 48);
  const expiringDocsCutoff = addDays(now, 14);
  const selectedDate = format(todayStart, "yyyy-MM-dd");

  const [
    urgentItems,
    routePlan,
    unassignedSoon,
    qaPending,
    continuationRequests,
    newLeads,
    staleCases,
    flaggedLaundry,
    expiringDocs,
  ] = await Promise.all([
    getAdminImmediateAttention(),
    buildDailyRoutePlan(selectedDate),
    db.job.findMany({
      where: {
        status: JobStatus.UNASSIGNED,
        scheduledDate: { gte: todayStart, lt: dayAfterTomorrowStart },
      },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
      take: 8,
      select: {
        id: true,
        jobNumber: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        jobType: true,
        property: { select: { name: true, suburb: true } },
      },
    }),
    db.job.findMany({
      where: { status: JobStatus.QA_REVIEW },
      orderBy: [{ scheduledDate: "asc" }, { updatedAt: "asc" }],
      take: 8,
      select: {
        id: true,
        jobNumber: true,
        scheduledDate: true,
        jobType: true,
        property: { select: { name: true, suburb: true } },
      },
    }),
    listContinuationRequests({ status: "PENDING" }),
    db.quoteLead.findMany({
      where: { createdAt: { gte: subHours(now, 24) } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        email: true,
        suburb: true,
        serviceType: true,
        createdAt: true,
      },
    }),
    db.issueTicket.findMany({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS"] },
        createdAt: { lte: staleCaseCutoff },
      },
      orderBy: [{ severity: "desc" }, { updatedAt: "asc" }],
      take: 8,
      select: {
        id: true,
        title: true,
        severity: true,
        caseType: true,
        createdAt: true,
        jobId: true,
        property: { select: { name: true, suburb: true } },
      },
    }),
    db.laundryTask.findMany({
      where: {
        status: { in: ["FLAGGED", "SKIPPED_PICKUP"] },
        OR: [
          { pickupDate: { gte: todayStart, lt: dayAfterTomorrowStart } },
          { dropoffDate: { gte: todayStart, lt: dayAfterTomorrowStart } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        status: true,
        pickupDate: true,
        dropoffDate: true,
        property: { select: { id: true, name: true, suburb: true } },
      },
    }),
    db.staffDocument.findMany({
      where: {
        expiresAt: { gte: now, lte: expiringDocsCutoff },
      },
      orderBy: { expiresAt: "asc" },
      take: 8,
      select: {
        id: true,
        title: true,
        category: true,
        expiresAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const continuationJobIds = Array.from(new Set(continuationRequests.map((row) => row.jobId)));
  const continuationJobs = continuationJobIds.length
    ? await db.job.findMany({
        where: { id: { in: continuationJobIds } },
        select: {
          id: true,
          jobNumber: true,
          scheduledDate: true,
          jobType: true,
          property: { select: { name: true, suburb: true } },
        },
      })
    : [];
  const continuationJobMap = new Map(continuationJobs.map((job) => [job.id, job]));

  const summaryCards = [
    {
      title: "Dispatch routes today",
      value: routePlan.length,
      detail: `${routePlan.reduce((sum, route) => sum + route.stops.length, 0)} assigned stops`,
      href: `/admin/jobs/route-map?date=${selectedDate}`,
      icon: Route,
    },
    {
      title: "Unassigned by tomorrow",
      value: unassignedSoon.length,
      detail: "Needs cleaner allocation",
      href: "/admin/jobs?status=UNASSIGNED",
      icon: ClipboardList,
    },
    {
      title: "Laundry exceptions",
      value: flaggedLaundry.length,
      detail: "Flagged or skipped pickup tasks",
      href: "/admin/laundry",
      icon: Shirt,
    },
    {
      title: "Compliance expiring",
      value: expiringDocs.length,
      detail: "Documents expiring in 14 days",
      href: "/admin/workforce",
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Operations</h1>
          <p className="text-sm text-muted-foreground">
            One inbox for dispatch, QA, cases, laundry follow-up, and compliance blockers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/jobs/route-map?date=${selectedDate}`}>Open route map</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/ops/map?date=${selectedDate}`}>Open live map</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/jobs">Open jobs</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <card.icon className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground">{card.detail}</p>
              <Button asChild size="sm" variant="outline">
                <Link href={card.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dispatch blockers</CardTitle>
            <CardDescription>Jobs needing assignment or continuation review in the next 48 hours.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {unassignedSoon.map((job) => (
              <Link key={job.id} href={`/admin/jobs/${job.id}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 hover:bg-muted/30">
                <div>
                  <p className="text-sm font-semibold">{job.property.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.property.suburb}  -  #{job.jobNumber}  -  {job.jobType.replace(/_/g, " ")}  -  {format(new Date(job.scheduledDate), "dd MMM")}
                    {job.startTime ? `  -  ${job.startTime}` : ""}
                    {job.dueTime ? ` - ${job.dueTime}` : ""}
                  </p>
                </div>
                <Badge variant="warning">Unassigned</Badge>
              </Link>
            ))}
            {continuationRequests.slice(0, 6).map((request) => {
              const job = continuationJobMap.get(request.jobId);
              return (
                <Link key={request.id} href={`/admin/jobs/${request.jobId}`} className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/50 px-3 py-3 hover:bg-amber-50">
                  <div>
                    <p className="text-sm font-semibold">{job?.property.name ?? "Continuation request"}</p>
                    <p className="text-xs text-muted-foreground">
                      {job?.property.suburb ? `${job.property.suburb}  -  ` : ""}
                      {job?.jobNumber ? `#${job.jobNumber}  -  ` : ""}
                      Requested {format(new Date(request.requestedAt), "dd MMM HH:mm")}
                    </p>
                    <p className="mt-1 text-xs">{request.reason}</p>
                  </div>
                  <Badge variant="destructive">Pending approval</Badge>
                </Link>
              );
            })}
            {unassignedSoon.length === 0 && continuationRequests.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground">
                No dispatch blockers right now.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>QA and cases</CardTitle>
            <CardDescription>Submission reviews and older unresolved cases that need movement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {qaPending.map((job) => (
              <Link key={job.id} href={`/admin/jobs/${job.id}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 hover:bg-muted/30">
                <div>
                  <p className="text-sm font-semibold">{job.property.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.property.suburb}  -  #{job.jobNumber}  -  {job.jobType.replace(/_/g, " ")}  -  {format(new Date(job.scheduledDate), "dd MMM")}
                  </p>
                </div>
                <Badge variant="warning">QA review</Badge>
              </Link>
            ))}
            {staleCases.map((item) => (
              <Link key={item.id} href={`/admin/cases?jobId=${item.jobId ?? ""}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 hover:bg-muted/30">
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.property?.name ? `${item.property.name}  -  ` : ""}
                    {item.property?.suburb ? `${item.property.suburb}  -  ` : ""}
                    {item.caseType}  -  Open since {format(new Date(item.createdAt), "dd MMM")}
                  </p>
                </div>
                <Badge variant={toneForSeverity(item.severity)}>{item.severity}</Badge>
              </Link>
            ))}
            {qaPending.length === 0 && staleCases.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground">
                No QA or case backlog right now.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>New leads</CardTitle>
            <CardDescription>Quote requests created in the last 24 hours.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {newLeads.map((lead) => (
              <Link key={lead.id} href="/admin/quotes" className="block rounded-xl border px-3 py-3 hover:bg-muted/30">
                <p className="text-sm font-semibold">{lead.name}</p>
                <p className="text-xs text-muted-foreground">
                  {lead.email}  -  {lead.suburb || "Area not set"}  -  {lead.serviceType.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Received {format(new Date(lead.createdAt), "dd MMM HH:mm")}</p>
              </Link>
            ))}
            {newLeads.length === 0 ? <p className="text-sm text-muted-foreground">No new leads in the last 24 hours.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Laundry exceptions</CardTitle>
            <CardDescription>Flagged pickups and skipped laundry actions that need admin review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {flaggedLaundry.map((task) => (
              <Link key={task.id} href="/admin/laundry" className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 hover:bg-muted/30">
                <div>
                  <p className="text-sm font-semibold">{task.property.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.property.suburb}  -  Pickup {format(new Date(task.pickupDate), "dd MMM")}  -  Drop-off {format(new Date(task.dropoffDate), "dd MMM")}
                  </p>
                </div>
                <Badge variant={statusBadgeVariant(task.status)}>{task.status.replace(/_/g, " ")}</Badge>
              </Link>
            ))}
            {flaggedLaundry.length === 0 ? <p className="text-sm text-muted-foreground">No flagged laundry work in the next two days.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expiring documents</CardTitle>
            <CardDescription>Compliance documents that will expire in the next 14 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {expiringDocs.map((doc) => (
              <Link key={doc.id} href="/admin/workforce" className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 hover:bg-muted/30">
                <div>
                  <p className="text-sm font-semibold">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.user.name ?? doc.user.email}  -  {doc.category}  -  Expires {doc.expiresAt ? format(new Date(doc.expiresAt), "dd MMM yyyy") : "-"}
                  </p>
                </div>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </Link>
            ))}
            {expiringDocs.length === 0 ? <p className="text-sm text-muted-foreground">No document expiries in the next 14 days.</p> : null}
          </CardContent>
        </Card>
      </div>

      <LiveCleanerLayer />

      <Card>
        <CardHeader>
          <CardTitle>Maps and routing</CardTitle>
          <CardDescription>Use the route board for cleaner runs and the live map for field status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/jobs/route-map?date=${selectedDate}`}>
              <Route className="mr-2 h-4 w-4" />
              Route map
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/ops/map?date=${selectedDate}`}>
              <MapPinned className="mr-2 h-4 w-4" />
              Full live map
            </Link>
          </Button>
        </CardContent>
      </Card>

      <ImmediateAttentionPanel
        title="Immediate Attention"
        description="Critical approvals, dispatch blockers, and unresolved operational items."
        items={urgentItems}
      />
    </div>
  );
}
