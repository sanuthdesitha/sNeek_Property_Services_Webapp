import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Building2, ClipboardList, FileText, Package, Plus, Shirt } from "lucide-react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { getClientImmediateAttention } from "@/lib/dashboard/immediate-attention";
import { ClientReportDownloadButton } from "@/components/client/report-download-button";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";

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
  const visibility = appSettings.clientPortalVisibility;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { client: { include: { properties: { where: { isActive: true } } } } },
  });

  const client = user?.client;

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
          status: { in: ["UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW"] },
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

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-primary/20">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.2fr_0.85fr]">
            <div className="p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Client Overview
              </p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
                {session.user.name ? `Welcome, ${session.user.name}` : "Welcome"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                {client?.name || "Your properties, reports, and service activity are tracked here."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {visibility.showQuoteRequests ? (
                  <Button size="sm" asChild>
                    <Link href="/client/quote">
                      <Plus className="mr-1.5 h-4 w-4" />
                      Request Quote
                    </Link>
                  </Button>
                ) : null}
                {visibility.showReports ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/client/reports">Reports</Link>
                  </Button>
                ) : null}
                {visibility.showInventory ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/client/inventory">Inventory</Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="border-t border-border/60 bg-muted/20 p-5 sm:p-6 lg:border-l lg:border-t-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Next Scheduled Service
              </p>
              {nextJob ? (
                <div className="mt-3 space-y-2">
                  <p className="text-base font-semibold">{nextJob.property.name}</p>
                  <p className="text-sm text-muted-foreground">{nextJob.property.suburb}</p>
                  <p className="text-sm">
                    {format(toZonedTime(nextJob.scheduledDate, TZ), "EEE dd MMM yyyy")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {nextJob.startTime || "Time not set"}
                    {nextJob.dueTime ? ` - ${nextJob.dueTime}` : ""}
                  </p>
                  {nextJob.priorityReason ? (
                    <p className="text-xs font-medium text-amber-700">{nextJob.priorityReason}</p>
                  ) : null}
                  <span className="inline-flex rounded-full border px-2 py-1 text-xs font-medium">
                    {nextJob.status.replace(/_/g, " ")}
                  </span>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No active jobs scheduled right now.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <ImmediateAttentionPanel
        title="Immediate Attention"
        description="Approvals, disputes, and service updates that need a quick response."
        items={urgentItems}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Properties</p>
              <p className="text-2xl font-semibold">{client?.properties?.length ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ongoing jobs</p>
              <p className="text-2xl font-semibold">{ongoingJobs.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tracked inventory</p>
              <p className="text-2xl font-semibold">{propertyStocks.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Recent reports</p>
              <p className="text-2xl font-semibold">{reports.length}</p>
            </div>
          </CardContent>
        </Card>
        {visibility.showFinanceDetails ? (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending charges</p>
                <p className="text-2xl font-semibold">
                  ${Number(financeOverview?.summary.pendingChargeTotal ?? 0).toFixed(2)}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Your Properties</CardTitle>
            <CardDescription>Active properties linked to this account.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(client?.properties ?? []).map((prop) => (
              <div key={prop.id} className="rounded-2xl border border-border/70 bg-white/70 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold sm:text-base">{prop.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground sm:text-sm">
                      {prop.address}, {prop.suburb}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {prop.bedrooms}bd | {prop.bathrooms}ba{prop.hasBalcony ? " | Balcony" : ""}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {!client?.properties?.length ? (
              <div className="sm:col-span-2 rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                No properties found for this account.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {visibility.showOngoingJobs ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Ongoing Jobs</CardTitle>
                <CardDescription>Current work scheduled across your properties.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {ongoingJobs.length > 0 ? (
                  ongoingJobs.slice(0, 5).map((job) => (
                    <div key={job.id} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                      <p className="text-sm font-semibold">{job.property.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {job.property.suburb} | {job.jobType.replace(/_/g, " ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}
                        {job.startTime ? ` | ${job.startTime}` : ""}
                        {job.dueTime ? ` - ${job.dueTime}` : ""}
                      </p>
                      {job.priorityReason ? (
                        <p className="mt-1 text-xs font-medium text-amber-700">{job.priorityReason}</p>
                      ) : null}
                      <span className="mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-medium">
                        {job.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
                    No ongoing jobs at the moment.
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {visibility.showLaundryUpdates ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Laundry Updates</CardTitle>
                <CardDescription>Pickup and return progress for your current laundry tasks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {laundryUpdates.length > 0 ? (
                  laundryUpdates.map((task) => {
                    const latestMeta = parseConfirmationMeta(task.confirmations[0]?.notes);
                    const totalPrice = typeof latestMeta?.totalPrice === "number" ? latestMeta.totalPrice : null;
                    return (
                      <div key={task.id} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                            <Shirt className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{task.property.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {task.property.suburb} | Pickup {format(toZonedTime(task.pickupDate, TZ), "dd MMM yyyy")} | Drop {format(toZonedTime(task.dropoffDate, TZ), "dd MMM yyyy")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Status: {task.status.replace(/_/g, " ")}
                              {task.droppedAt ? ` | Returned ${format(toZonedTime(task.droppedAt, TZ), "dd MMM yyyy")}` : ""}
                            </p>
                            {visibility.showLaundryCosts && totalPrice != null ? (
                              <p className="mt-2 text-xs text-muted-foreground">Laundry charge: ${Number(totalPrice).toFixed(2)}</p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
                    No laundry updates available right now.
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {visibility.showReports ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Recent Reports</CardTitle>
                <CardDescription>Latest available cleaning reports.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {reports.length > 0 ? (
                  reports.map((report) => (
                    <div key={report.id} className="rounded-2xl border border-border/70 bg-white/70 p-3">
                      <p className="text-sm font-semibold">{report.job.property.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {report.job.jobType.replace(/_/g, " ")} | {format(toZonedTime(report.job.scheduledDate, TZ), "dd MMM yyyy")}
                      </p>
                      {visibility.showReportDownloads ? (
                        <div className="mt-3">
                          <ClientReportDownloadButton jobId={report.job.id} />
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">PDF downloads are hidden by admin.</p>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
                    No reports available yet.
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {visibility.showFinanceDetails ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Finance Snapshot</CardTitle>
                    <CardDescription>
                      Admin-approved pricing and invoice totals for your account.
                    </CardDescription>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/client/finance">Open finance</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
                  <p className="text-xs text-muted-foreground">Active property rates</p>
                  <p className="mt-1 text-2xl font-semibold">{financeOverview?.summary.activeRates ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
                  <p className="text-xs text-muted-foreground">Total billed</p>
                  <p className="mt-1 text-2xl font-semibold">
                    ${Number(financeOverview?.summary.totalBilled ?? 0).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
                  <p className="text-xs text-muted-foreground">Pending billable services</p>
                  <p className="mt-1 text-2xl font-semibold">{financeOverview?.summary.pendingChargeCount ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-white/70 p-3">
                  <p className="text-xs text-muted-foreground">Invoice count</p>
                  <p className="mt-1 text-2xl font-semibold">{financeOverview?.summary.invoiceCount ?? 0}</p>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      {visibility.showInventory ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Inventory Snapshot</CardTitle>
                <CardDescription>Low-stock visibility across each property.</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href="/client/inventory">View all inventory</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/client/shopping">Start shopping</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {inventoryByProperty.map((property) => (
              <div key={property.id} className="rounded-2xl border border-border/70 bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{property.name}</p>
                    <p className="text-xs text-muted-foreground">{property.totalTracked} items tracked</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                      property.lowCount > 0
                        ? "border border-destructive/40 bg-destructive/10 text-destructive"
                        : "border border-border/70 text-muted-foreground"
                    }`}
                  >
                    {property.lowCount} low stock
                  </span>
                </div>
                {property.preview.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    {property.preview.map((item) => (
                      <p key={item.name} className="text-xs text-muted-foreground">
                        {item.name}: {item.onHand} / par {item.par}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">No low-stock items currently flagged.</p>
                )}
              </div>
            ))}
            {inventoryByProperty.length === 0 ? (
              <div className="sm:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No inventory tracked yet for these properties.
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
