import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { ArrowLeft, Building2, ClipboardList, Package, Shirt, CalendarDays } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { getClientPropertyDetailForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { buildLaundryConfirmationMediaItems, getLaundryConfirmationLabel } from "@/lib/laundry/media";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ClientReportDownloadButton } from "@/components/client/report-download-button";
import { PreferredCleanerCard } from "@/components/client/preferred-cleaner-card";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Property · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: string): Tone {
  const s = status.toUpperCase();
  if (["COMPLETED", "INVOICED", "RETURNED", "DELIVERED"].includes(s)) return "success";
  if (["IN_PROGRESS", "EN_ROUTE", "ASSIGNED", "PICKED_UP"].includes(s)) return "info";
  if (["UNASSIGNED", "OFFERED", "PAUSED", "SCHEDULED"].includes(s)) return "warning";
  return "neutral";
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ");
}

export default async function ClientPropertyDetailPage({ params }: { params: { id: string } }) {
  await ensureClientModuleAccess("properties");
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings).catch(() => null);
  const detail = portal
    ? await getClientPropertyDetailForUser(session.user.id, params.id, portal.visibility).catch(() => null)
    : null;

  if (!detail || !portal) notFound();

  const {
    property,
    reports,
    jobs,
    laundryTasks,
    stocks,
    checklistTemplates,
    activity,
    conditionTimeline,
    preferredCleanerOptions,
  } = detail;
  const visibility = portal.visibility;
  const lowStock = stocks.filter((row) => Number(row.onHand) <= Number(row.reorderThreshold));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/v2/client/properties" aria-label="Back to properties">
          <EButton variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></EButton>
        </Link>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Properties</span>
      </div>

      <EPageHeader
        eyebrow="Your home"
        title={property.name}
        description={`${property.address}, ${property.suburb}, ${property.state} ${property.postcode}`}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EStatCard label="Property setup" value={`${property.bedrooms}bd · ${property.bathrooms}ba`} delta="rooms" deltaTone="neutral" icon={<Building2 className="h-4 w-4" />} />
        <EStatCard label="Active jobs" value={String(jobs.length)} delta="upcoming / in flight" deltaTone="neutral" icon={<ClipboardList className="h-4 w-4" />} />
        <EStatCard label="Low stock items" value={String(lowStock.length)} delta="need reorder" deltaTone={lowStock.length ? "danger" : "neutral"} icon={<Package className="h-4 w-4" />} />
        <EStatCard label="Laundry updates" value={String(laundryTasks.length)} delta="tracked tasks" deltaTone="neutral" icon={<Shirt className="h-4 w-4" />} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          {visibility.showChecklistPreview ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Checklist templates</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Read-only preview of the active checklist template assigned to this property.</p>
              </ECardHeader>
              <ECardBody className="space-y-4 pt-0">
                {checklistTemplates.length === 0 ? (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active checklist templates found.</p>
                ) : (
                  checklistTemplates.map((template) => (
                    <div key={`${template.jobType}-${template.id}`} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                      <div className="mb-3">
                        <p className="font-[550]">{titleCase(template.jobType)}</p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {template.name} v{template.version} · {template.source === "property_override" ? "Property override" : "Global default"}
                        </p>
                      </div>
                      <div className="space-y-3">
                        {template.sections.map((section) => (
                          <div key={section.id} className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] p-3">
                            <p className="text-[0.8125rem] font-[550]">{section.label}</p>
                            <ul className="mt-2 space-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                              {section.fields.map((field) => (
                                <li key={field.id}>{field.label}{field.required ? " · required" : ""}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </ECardBody>
            </ECard>
          ) : null}

          {visibility.showInventory ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Inventory summary</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Low stock and tracked inventory for this property.</p>
              </ECardHeader>
              <ECardBody className="space-y-3 pt-0">
                {stocks.length === 0 ? (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No inventory tracked for this property.</p>
                ) : lowStock.length > 0 ? (
                  <div className="space-y-2">
                    {lowStock.slice(0, 8).map((row) => (
                      <div key={row.id} className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-danger)/0.3)] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem]">
                        <p className="font-[550]">{row.item.name}</p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">On hand {row.onHand} {row.item.unit} · Threshold {row.reorderThreshold}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No low stock items right now.</p>
                )}
              </ECardBody>
            </ECard>
          ) : null}

          {visibility.showLaundryUpdates ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Laundry schedule</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Current laundry timeline, pickup, return, and image updates.</p>
              </ECardHeader>
              <ECardBody className="space-y-3 pt-0">
                {laundryTasks.length === 0 ? (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No laundry updates for this property.</p>
                ) : (
                  laundryTasks.map((task) => (
                    <div key={task.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-[550]">{task.job.jobNumber ? `Job ${task.job.jobNumber}` : "Laundry task"} · {titleCase(task.job.jobType)}</p>
                          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                            Pickup {format(toZonedTime(task.pickupDate, TZ), "dd MMM yyyy")} · Drop off {format(toZonedTime(task.dropoffDate, TZ), "dd MMM yyyy")}
                          </p>
                        </div>
                        <EBadge tone={statusTone(task.status)} soft>{titleCase(task.status)}</EBadge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {task.confirmations.map((confirmation) => (
                          <div key={confirmation.id} className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem]">
                            <p className="font-[550]">{format(confirmation.createdAt, "dd MMM yyyy HH:mm")}</p>
                            <p className="text-[hsl(var(--e-muted-foreground))]">
                              {getLaundryConfirmationLabel(confirmation)}
                              {confirmation.bagLocation ? ` · ${confirmation.bagLocation}` : ""}
                            </p>
                            {task.skipReasonCode ? <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Reason: {titleCase(task.skipReasonCode)}</p> : null}
                            {task.skipReasonNote ? <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{task.skipReasonNote}</p> : null}
                            {visibility.showLaundryImages && confirmation.photoUrl ? (
                              <MediaGallery
                                items={buildLaundryConfirmationMediaItems([confirmation])}
                                title="Laundry image"
                                className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </ECardBody>
            </ECard>
          ) : null}
        </div>

        <div className="space-y-6">
          <ECard>
            <ECardHeader>
              <ECardTitle>Upcoming job updates</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Status-focused view of upcoming work at this property.</p>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              {jobs.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active jobs scheduled right now.</p>
              ) : (
                jobs.map((job) => (
                  <div key={job.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-[550]">{job.jobNumber ? `Job ${job.jobNumber}` : "Job"} · {titleCase(job.jobType)}</p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {format(toZonedTime(job.scheduledDate, TZ), "EEE dd MMM yyyy")}
                          {job.startTime ? ` · ${job.startTime}` : ""}
                          {job.dueTime ? ` - ${job.dueTime}` : ""}
                        </p>
                      </div>
                      <EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
                    </div>
                    {visibility.showCleanerNames && job.assignments.length > 0 ? (
                      <p className="mt-2 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        Assigned: {job.assignments.map((a) => a.user?.name || "Cleaner").join(", ")}
                      </p>
                    ) : null}
                    {job.priorityReason ? <p className="mt-2 text-[0.6875rem] font-[550] text-[hsl(var(--e-warning))]">{job.priorityReason}</p> : null}
                  </div>
                ))
              )}
            </ECardBody>
          </ECard>

          {visibility.showReports ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Recent reports</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Completed reports linked to this property.</p>
              </ECardHeader>
              <ECardBody className="space-y-3 pt-0">
                {reports.length === 0 ? (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No reports available yet.</p>
                ) : (
                  reports.map((report) => (
                    <div key={report.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                      <p className="font-[550]">{report.job.jobNumber ? `Job ${report.job.jobNumber}` : "Report"} · {titleCase(report.job.jobType)}</p>
                      <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{format(toZonedTime(report.job.scheduledDate, TZ), "dd MMM yyyy")}</p>
                      {visibility.showReportDownloads ? (
                        <div className="mt-3">
                          <ClientReportDownloadButton jobId={report.job.id} label="Download PDF" />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </ECardBody>
            </ECard>
          ) : null}

          <ECard>
            <ECardHeader>
              <ECardTitle>Property activity</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Combined job, report, laundry, and task updates.</p>
            </ECardHeader>
            <ECardBody className="space-y-3 pt-0">
              {activity.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No recent activity for this property.</p>
              ) : (
                activity.slice(0, 20).map((item, index) => (
                  <div key={`${item.type}-${index}-${item.at.toISOString()}`} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                    <div className="flex items-center gap-2 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      <CalendarDays className="h-4 w-4" />
                      <span>{format(item.at, "dd MMM yyyy HH:mm")}</span>
                    </div>
                    <p className="mt-2 text-[0.8125rem] font-[550]">{item.label}</p>
                    <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{item.detail}</p>
                  </div>
                ))
              )}
            </ECardBody>
          </ECard>

          <PreferredCleanerCard
            propertyId={property.id}
            currentCleanerId={property.preferredCleanerUserId}
            options={preferredCleanerOptions}
          />

          <ECard>
            <ECardHeader>
              <ECardTitle>Condition timeline</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Visual history from previous cleans for this property.</p>
            </ECardHeader>
            <ECardBody className="space-y-4 pt-0">
              {conditionTimeline.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No media history is available for this property yet.</p>
              ) : (
                conditionTimeline.map((item) => (
                  <div key={item.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-[550]">
                          {item.submission.job.jobNumber ? `Job ${item.submission.job.jobNumber}` : "Completed job"} · {titleCase(item.submission.job.jobType)}
                        </p>
                        <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{format(toZonedTime(item.submission.job.scheduledDate, TZ), "dd MMM yyyy")}</p>
                      </div>
                      <EBadge tone="neutral" soft>{item.mediaType}</EBadge>
                    </div>
                    <MediaGallery
                      items={[{ id: item.id, url: item.url, label: item.label || "Property history media", mediaType: item.mediaType }]}
                      title={item.label || "Property history"}
                      className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
                    />
                  </div>
                ))
              )}
            </ECardBody>
          </ECard>
        </div>
      </div>
    </div>
  );
}
