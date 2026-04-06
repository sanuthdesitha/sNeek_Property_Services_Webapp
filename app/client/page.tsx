import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CalendarDays, CheckCircle2, ClipboardList, CreditCard, FileText, Package, Plus, Shirt } from "lucide-react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { getClientImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { ClientReportDownloadButton } from "@/components/client/report-download-button";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";
import { getClientPortalContext } from "@/lib/client/portal";

const TZ = "Australia/Sydney";

function parseConfirmationMeta(notes: string | null | undefined) {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

export default async function ClientDashboard() {
  const session = await requireRole([Role.CLIENT]);
  const appSettings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, appSettings);
  const visibility = portal.visibility;

  const client = await db.client.findUnique({
    where: { id: portal.clientId ?? "__missing__" },
    include: { properties: { where: { isActive: true } } },
  });

  const reports = client
    ? await db.report.findMany({
        where: {
          job: { property: { clientId: client.id }, status: { in: ["COMPLETED", "INVOICED"] } },
        },
        include: {
          job: {
            select: {
              id: true,
              scheduledDate: true,
              jobType: true,
              property: { select: { name: true, suburb: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];

  const ongoingJobs = client
    ? await db.job.findMany({
        where: {
          property: { clientId: client.id },
          status: { in: ["UNASSIGNED", "OFFERED", "ASSIGNED", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW"] },
        },
        select: {
          id: true,
          jobType: true,
          status: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          priorityBucket: true,
          priorityReason: true,
          property: { select: { name: true, suburb: true } },
        },
        orderBy: [
          { scheduledDate: "asc" },
          { priorityBucket: "asc" },
          { dueTime: "asc" },
          { startTime: "asc" },
        ],
        take: 20,
      })
    : [];

  const propertyStocks = client
    ? await db.propertyStock.findMany({
        where: { property: { clientId: client.id } },
        include: {
          property: { select: { id: true, name: true } },
          item: { select: { name: true } },
        },
        orderBy: [{ property: { name: "asc" } }, { item: { name: "asc" } }],
        take: 2000,
      })
    : [];

  const laundryUpdates = client && visibility.showLaundryUpdates
    ? await db.laundryTask.findMany({
        where: { property: { clientId: client.id } },
        select: {
          id: true,
          status: true,
          pickupDate: true,
          dropoffDate: true,
          droppedAt: true,
          property: { select: { name: true, suburb: true } },
          confirmations: {
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { notes: true },
          },
        },
        orderBy: [{ pickupDate: "asc" }],
        take: 6,
      })
    : [];

  const inventoryByProperty = (client?.properties ?? []).map((property) => {
    const rows = propertyStocks.filter((stock) => stock.propertyId === property.id);
    const low = rows.filter((row) => row.onHand <= row.reorderThreshold);
    return {
      id: property.id,
      name: property.name,
      totalTracked: rows.length,
      lowCount: low.length,
      preview: low.slice(0, 3).map((row) => ({
        name: row.item.name,
        onHand: row.onHand,
        par: row.parLevel,
      })),
    };
  });

  const nextJob = ongoingJobs[0] ?? null;
  const financeOverview =
    client && visibility.showFinanceDetails ? await getClientFinanceOverview(client.id) : null;
  const urgentItems = await getClientImmediateAttention({
    clientId: client?.id ?? null,
    visibility,
  });

  const pendingChargeTotal = Number(financeOverview?.summary.pendingChargeTotal ?? 0);

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ─── WELCOME HERO ─── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden border-primary/20">
          <CardContent className="p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Client Dashboard</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
              {session.user.name ? `Welcome back, ${session.user.name.split(" ")[0]}` : "Welcome back"}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {client?.name || "Your properties, reports, and service activity are tracked here."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {visibility.showQuoteRequests && (
                <Button size="sm" asChild>
                  <Link href="/client/quote"><Plus className="mr-1.5 h-3.5 w-3.5" />Request Quote</Link>
                </Button>
              )}
              {visibility.showBooking && (
                <Button size="sm" variant="outline" asChild>
                  <Link href="/client/booking">Book a Clean</Link>
                </Button>
              )}
              {visibility.showJobs && (
                <Button size="sm" variant="outline" asChild>
                  <Link href="/client/jobs">All Jobs <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Next service card */}
        <Card className="border-primary/20 bg-primary/4">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <CalendarDays className="h-3.5 w-3.5" />
              Next Service
            </div>
            {nextJob ? (
              <div className="mt-3 space-y-1.5">
                <p className="font-semibold">{nextJob.property.name}</p>
                <p className="text-sm text-muted-foreground">{nextJob.property.suburb}</p>
                <p className="text-sm font-medium text-foreground">
                  {format(toZonedTime(nextJob.scheduledDate, TZ), "EEE, dd MMM yyyy")}
                </p>
                {nextJob.startTime && (
                  <p className="text-sm text-muted-foreground">
                    {nextJob.startTime}{nextJob.dueTime ? ` – ${nextJob.dueTime}` : ""}
                  </p>
                )}
                <Badge variant="secondary" className="mt-1 text-[11px]">
                  {nextJob.status.replace(/_/g, " ")}
                </Badge>
                {nextJob.priorityReason && (
                  <p className="text-xs font-medium text-amber-600">{nextJob.priorityReason}</p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No active jobs scheduled.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── ATTENTION PANEL ─── */}
      <ImmediateAttentionPanel
        title="Requires Attention"
        description="Approvals, disputes, and service updates that need a quick response."
        items={urgentItems}
      />

      {/* ─── STAT CARDS ─── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: Building2, label: "Properties", value: client?.properties?.length ?? 0, href: visibility.showProperties ? "/client/properties" : null },
          { icon: ClipboardList, label: "Active jobs", value: ongoingJobs.length, href: visibility.showJobs ? "/client/jobs" : null },
          { icon: FileText, label: "Recent reports", value: reports.length, href: visibility.showReports ? "/client/reports" : null },
          ...(visibility.showFinanceDetails ? [{ icon: CreditCard, label: "Pending charges", value: `$${pendingChargeTotal.toFixed(2)}`, href: "/client/finance" }] : [{ icon: Package, label: "Tracked items", value: propertyStocks.length, href: visibility.showInventory ? "/client/inventory" : null }]),
        ].map((stat) => (
          <Card key={stat.label} className="transition-all duration-200 hover:border-primary/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                  <stat.icon className="h-4.5 w-4.5 text-primary" />
                </div>
                {stat.href && (
                  <Link href={stat.href} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                    View <ArrowRight className="inline h-3 w-3" />
                  </Link>
                )}
              </div>
              <p className="mt-3 text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── MAIN GRID ─── */}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">

        {/* Left — Jobs + Properties */}
        <div className="space-y-4">
          {visibility.showOngoingJobs && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Upcoming & Active Jobs</CardTitle>
                {visibility.showJobs && (
                  <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                    <Link href="/client/jobs">View all</Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2.5">
                {ongoingJobs.length > 0 ? (
                  ongoingJobs.slice(0, 6).map((job) => {
                    const isInProgress = job.status === "IN_PROGRESS";
                    const isCompleted = ["SUBMITTED", "QA_REVIEW"].includes(job.status);
                    return (
                      <div
                        key={job.id}
                        className={`rounded-2xl border p-4 transition-all duration-150 ${isInProgress ? "border-primary/40 bg-primary/5" : "border-border/60 hover:border-primary/20"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold">{job.property.name}</p>
                              {isInProgress && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                  In Progress
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {job.jobType.replace(/_/g, " ")} · {job.property.suburb}
                            </p>
                            <p className="mt-1 text-xs font-medium">
                              {format(toZonedTime(job.scheduledDate, TZ), "EEE dd MMM")}
                              {job.startTime ? ` · ${job.startTime}` : ""}
                              {job.dueTime ? ` – ${job.dueTime}` : ""}
                            </p>
                          </div>
                          <Badge variant={isCompleted ? "secondary" : "outline"} className="shrink-0 text-[11px]">
                            {job.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {job.priorityReason && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {job.priorityReason}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
                    <p className="mt-2 text-sm text-muted-foreground">No active jobs right now.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {visibility.showProperties && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Your Properties</CardTitle>
                <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                  <Link href="/client/properties">Manage</Link>
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {(client?.properties ?? []).map((prop) => (
                  <Link
                    key={prop.id}
                    href={`/client/properties/${prop.id}`}
                    className="group flex items-start gap-3 rounded-2xl border border-border/60 p-4 transition-all duration-150 hover:border-primary/30 hover:bg-primary/4"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold group-hover:text-primary transition-colors">{prop.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{prop.suburb}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {prop.bedrooms}bd · {prop.bathrooms}ba{prop.hasBalcony ? " · Balcony" : ""}
                      </p>
                    </div>
                  </Link>
                ))}
                {!client?.properties?.length && (
                  <div className="sm:col-span-2 rounded-2xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                    No properties found for this account.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {visibility.showInventory && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Inventory Snapshot</CardTitle>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                    <Link href="/client/inventory">View</Link>
                  </Button>
                  {visibility.showShopping && (
                    <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                      <Link href="/client/shopping">Shop</Link>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {inventoryByProperty.map((property) => (
                  <div key={property.id} className="rounded-2xl border border-border/60 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{property.name}</p>
                        <p className="text-xs text-muted-foreground">{property.totalTracked} items tracked</p>
                      </div>
                      {property.lowCount > 0 && (
                        <Badge variant="destructive" className="shrink-0 text-[11px]">{property.lowCount} low</Badge>
                      )}
                    </div>
                    {property.preview.length > 0 && (
                      <div className="mt-3 space-y-1 border-t border-border/40 pt-2">
                        {property.preview.map((item) => (
                          <p key={item.name} className="text-xs text-muted-foreground">
                            {item.name}: <span className="text-destructive font-medium">{item.onHand}</span> / par {item.par}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {inventoryByProperty.length === 0 && (
                  <div className="sm:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                    No inventory tracked yet.
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right — Laundry + Reports + Finance */}
        <div className="space-y-4">
          {visibility.showLaundryUpdates && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Laundry Updates</CardTitle>
                <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                  <Link href="/client/laundry">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {laundryUpdates.length > 0 ? (
                  laundryUpdates.map((task) => {
                    const meta = parseConfirmationMeta(task.confirmations[0]?.notes);
                    const price = typeof meta?.totalPrice === "number" ? meta.totalPrice : null;
                    const isComplete = task.status === "DROPPED";
                    return (
                      <div key={task.id} className="rounded-2xl border border-border/60 p-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                            <Shirt className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{task.property.name}</p>
                            <p className="text-xs text-muted-foreground">{task.property.suburb}</p>
                          </div>
                          <Badge variant={isComplete ? "secondary" : "outline"} className="shrink-0 text-[11px]">
                            {task.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                          <span>Pickup: {format(toZonedTime(task.pickupDate, TZ), "dd MMM")}</span>
                          <span>Return: {format(toZonedTime(task.dropoffDate, TZ), "dd MMM")}</span>
                          {task.droppedAt && (
                            <span className="col-span-2">Returned: {format(toZonedTime(task.droppedAt, TZ), "dd MMM yyyy")}</span>
                          )}
                        </div>
                        {visibility.showLaundryCosts && price != null && (
                          <p className="mt-1.5 text-xs font-medium text-primary">Charge: ${price.toFixed(2)}</p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="px-1 py-4 text-center text-sm text-muted-foreground">No laundry updates.</p>
                )}
              </CardContent>
            </Card>
          )}

          {visibility.showReports && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Recent Reports</CardTitle>
                <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                  <Link href="/client/reports">All reports</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {reports.length > 0 ? (
                  reports.map((report) => (
                    <div key={report.id} className="rounded-2xl border border-border/60 p-3.5">
                      <p className="text-sm font-semibold">{report.job.property.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {report.job.jobType.replace(/_/g, " ")} · {format(toZonedTime(report.job.scheduledDate, TZ), "dd MMM yyyy")}
                      </p>
                      {visibility.showReportDownloads && (
                        <div className="mt-2">
                          <ClientReportDownloadButton jobId={report.job.id} />
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">No reports yet.</p>
                )}
              </CardContent>
            </Card>
          )}

          {visibility.showFinanceDetails && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Finance</CardTitle>
                <Button size="sm" variant="ghost" asChild className="h-7 text-xs">
                  <Link href="/client/finance">Open</Link>
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2.5">
                {[
                  { label: "Active rates", value: financeOverview?.summary.activeRates ?? 0 },
                  { label: "Total billed", value: `$${Number(financeOverview?.summary.totalBilled ?? 0).toFixed(2)}` },
                  { label: "Pending", value: financeOverview?.summary.pendingChargeCount ?? 0 },
                  { label: "Invoices", value: financeOverview?.summary.invoiceCount ?? 0 },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-lg font-bold">{s.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
