import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ArrowLeft, Building2, CalendarDays, ClipboardList, Package, Shirt } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { getClientPropertyDetailForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClientReportDownloadButton } from "@/components/client/report-download-button";

const TZ = "Australia/Sydney";

export default async function ClientPropertyDetailPage({ params }: { params: { id: string } }) {
  await ensureClientModuleAccess("properties");
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const detail = await getClientPropertyDetailForUser(session.user.id, params.id, portal.visibility);

  if (!detail) notFound();

  const { property, reports, jobs, laundryTasks, stocks, checklistTemplates, activity } = detail;
  const lowStock = stocks.filter((row) => Number(row.onHand) <= Number(row.reorderThreshold));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/client/properties">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to properties
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{property.name}</h1>
            <p className="text-sm text-muted-foreground">
              {property.address}, {property.suburb}, {property.state} {property.postcode}
            </p>
          </div>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Property setup</p>
              <p className="text-base font-semibold">{property.bedrooms}bd / {property.bathrooms}ba</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Upcoming / active jobs</p>
              <p className="text-base font-semibold">{jobs.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Low stock items</p>
              <p className="text-base font-semibold">{lowStock.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Shirt className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Laundry updates</p>
              <p className="text-base font-semibold">{laundryTasks.length}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          {portal.visibility.showChecklistPreview ? (
            <Card>
              <CardHeader>
                <CardTitle>Checklist templates</CardTitle>
                <CardDescription>
                  Read-only preview of the active checklist template assigned to this property.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {checklistTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active checklist templates found.</p>
                ) : (
                  checklistTemplates.map((template) => (
                    <div key={`${template.jobType}-${template.id}`} className="rounded-xl border p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{template.jobType.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">
                            {template.name} v{template.version} • {template.source === "property_override" ? "Property override" : "Global default"}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {template.sections.map((section) => (
                          <div key={section.id} className="rounded-lg bg-muted/30 p-3">
                            <p className="text-sm font-medium">{section.label}</p>
                            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                              {section.fields.map((field) => (
                                <li key={field.id}>
                                  {field.label}
                                  {field.required ? " • required" : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}

          {portal.visibility.showInventory ? (
            <Card>
              <CardHeader>
                <CardTitle>Inventory summary</CardTitle>
                <CardDescription>Low stock and tracked inventory for this property.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {stocks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No inventory tracked for this property.</p>
                ) : (
                  <>
                    {lowStock.length > 0 ? (
                      <div className="space-y-2">
                        {lowStock.slice(0, 8).map((row) => (
                          <div key={row.id} className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
                            <p className="font-medium">{row.item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              On hand {row.onHand} {row.item.unit} • Threshold {row.reorderThreshold}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No low stock items right now.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {portal.visibility.showLaundryUpdates ? (
            <Card>
              <CardHeader>
                <CardTitle>Laundry schedule</CardTitle>
                <CardDescription>Current laundry timeline, pickup, return, and image updates.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {laundryTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No laundry updates for this property.</p>
                ) : (
                  laundryTasks.map((task) => (
                    <div key={task.id} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">
                            {task.job.jobNumber ? `Job ${task.job.jobNumber}` : "Laundry task"} • {task.job.jobType.replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Pickup {format(toZonedTime(task.pickupDate, TZ), "dd MMM yyyy")} • Drop off {format(toZonedTime(task.dropoffDate, TZ), "dd MMM yyyy")}
                          </p>
                        </div>
                        <span className="rounded-full border px-2 py-1 text-xs font-medium">
                          {task.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {task.confirmations.map((confirmation) => (
                          <div key={confirmation.id} className="rounded-lg bg-muted/30 p-3 text-sm">
                            <p className="font-medium">{format(confirmation.createdAt, "dd MMM yyyy HH:mm")}</p>
                            <p className="text-muted-foreground">
                              {confirmation.laundryReady ? "Cleaner marked ready" : "Laundry update sent"}
                              {confirmation.bagLocation ? ` • ${confirmation.bagLocation}` : ""}
                            </p>
                            {task.skipReasonCode ? (
                              <p className="text-xs text-muted-foreground">Reason: {task.skipReasonCode.replace(/_/g, " ")}</p>
                            ) : null}
                            {task.skipReasonNote ? <p className="text-xs text-muted-foreground">{task.skipReasonNote}</p> : null}
                            {portal.visibility.showLaundryImages && confirmation.photoUrl ? (
                              <a href={confirmation.photoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary underline">
                                View image
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming job updates</CardTitle>
              <CardDescription>Status-focused view of upcoming work at this property.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active jobs scheduled right now.</p>
              ) : (
                jobs.map((job) => (
                  <div key={job.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {job.jobNumber ? `Job ${job.jobNumber}` : "Job"} • {job.jobType.replace(/_/g, " ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(toZonedTime(job.scheduledDate, TZ), "EEE dd MMM yyyy")}
                          {job.startTime ? ` • ${job.startTime}` : ""}
                          {job.dueTime ? ` - ${job.dueTime}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full border px-2 py-1 text-xs font-medium">
                        {job.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    {portal.visibility.showCleanerNames && job.assignments.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Assigned: {job.assignments.map((assignment) => assignment.user?.name || "Cleaner").join(", ")}
                      </p>
                    ) : null}
                    {job.priorityReason ? <p className="mt-2 text-xs font-medium text-amber-700">{job.priorityReason}</p> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {portal.visibility.showReports ? (
            <Card>
              <CardHeader>
                <CardTitle>Recent reports</CardTitle>
                <CardDescription>Completed reports linked to this property.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {reports.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reports available yet.</p>
                ) : (
                  reports.map((report) => (
                    <div key={report.id} className="rounded-xl border p-4">
                      <p className="font-medium">
                        {report.job.jobNumber ? `Job ${report.job.jobNumber}` : "Report"} • {report.job.jobType.replace(/_/g, " ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {format(toZonedTime(report.job.scheduledDate, TZ), "dd MMM yyyy")}
                      </p>
                      {portal.visibility.showReportDownloads ? (
                        <div className="mt-3">
                          <ClientReportDownloadButton jobId={report.job.id} label="Download PDF" />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Property activity</CardTitle>
              <CardDescription>Combined job, report, laundry, and task updates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity for this property.</p>
              ) : (
                activity.slice(0, 20).map((item, index) => (
                  <div key={`${item.type}-${index}-${item.at.toISOString()}`} className="rounded-xl border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CalendarDays className="h-4 w-4" />
                      <span>{format(item.at, "dd MMM yyyy HH:mm")}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
