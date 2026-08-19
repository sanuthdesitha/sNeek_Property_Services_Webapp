import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ClipboardList,
  Package,
  Shirt,
} from "lucide-react";
import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { getClientPropertyDetailForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import {
  buildLaundryConfirmationMediaItems,
  getLaundryConfirmationLabel,
} from "@/lib/laundry/media";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
  EPageHeader,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import { EMediaStrip } from "@/components/v2/client/properties/media-strip";
import {
  EPreferredCleanerCard,
  EReportDownloadButton,
} from "@/components/v2/client/properties/property-actions";

export const metadata = { title: "Property · Estate client" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info";

function statusTone(status: string): Tone {
  const s = status.toUpperCase();
  if (["COMPLETED", "INVOICED", "RESOLVED", "DROPPED_OFF", "RETURNED"].includes(s)) return "success";
  if (["IN_PROGRESS", "EN_ROUTE", "ASSIGNED", "PICKED_UP", "QA_REVIEW", "SUBMITTED"].includes(s)) return "info";
  if (["UNASSIGNED", "OFFERED", "PAUSED", "SCHEDULED", "WAITING_CONTINUATION_APPROVAL"].includes(s)) return "warning";
  if (["CANCELLED", "SKIPPED_PICKUP", "DISMISSED"].includes(s)) return "danger";
  return "neutral";
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type TimelineMedia = {
  id: string;
  url: string;
  label?: string | null;
  mediaType: string;
  submission: {
    job: { id: string; jobNumber?: string | null; jobType: string; scheduledDate: Date | string };
  };
};

/**
 * Collapse the flat media feed into one entry per job, newest first — a
 * client thinks in visits ("what did the clean on 3 August look like?"), not
 * in individual files. Input order is preserved within each group.
 */
function groupTimelineByJob(items: TimelineMedia[]) {
  const groups = new Map<
    string,
    {
      jobId: string;
      jobNumber?: string | null;
      jobType: string;
      scheduledDate: Date | string;
      items: TimelineMedia[];
    }
  >();

  for (const item of items) {
    const job = item.submission?.job;
    if (!job?.id) continue;
    const existing = groups.get(job.id);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(job.id, {
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobType: job.jobType,
      scheduledDate: job.scheduledDate,
      items: [item],
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime()
  );
}

/**
 * How many rows each section on this page shows.
 *
 * The property page had become a dumping ground: every laundry task, every
 * upcoming job, every report and twenty activity entries, all expanded, so the
 * thing a client actually came for was several screens down. Each section is
 * now a recent snapshot with a link to the full page for that topic, which is
 * where the filtering and paging already live.
 */
const BRIEF_ROWS = 3;

/**
 * Footer link out of a summarised section.
 *
 * Renders nothing when the section already showed everything — a "see all 2 of
 * 2" link is noise. When there IS more, it says how much, so the client knows
 * the list was trimmed rather than assuming that is all there is.
 */
function SeeAll({ href, total, label }: { href: string; total: number; label: string }) {
  if (total <= BRIEF_ROWS) return null;
  return (
    <div className="pt-3">
      <Link
        href={href}
        className="text-[0.8125rem] font-[600] text-[hsl(var(--e-gold-ink))] hover:underline"
      >
        See all {total} {label} →
      </Link>
    </div>
  );
}

export default async function EstateClientPropertyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // Same module and permission as the properties LIST page, so a VA who can
  // see the list can open a row instead of hitting a crash.
  const portalCtx = await requireClientPortalPage({
    module: "properties",
    permission: "properties",
  });
  const session = { user: { id: portalCtx.userId, name: portalCtx.userName } };
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const detail = await getClientPropertyDetailForUser(session.user.id, params.id, portal.visibility);

  if (!detail) notFound();

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
  const lowStock = stocks.filter((row) => Number(row.onHand) <= Number(row.reorderThreshold));

  // "Active" job types are the ones this property actually gets. Listing every
  // template in the system made a client with only turnovers scroll past
  // deep-clean, end-of-lease and commercial checklists that will never run
  // here. A property with no jobs yet still shows everything — otherwise a
  // newly onboarded home would show nothing at all, which is worse.
  const activeJobTypes = new Set(jobs.map((job) => job.jobType));

  const visibleChecklistTemplates =
    activeJobTypes.size > 0
      ? checklistTemplates.filter((template) => activeJobTypes.has(template.jobType))
      : checklistTemplates;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <EButton asChild variant="ghost" size="sm">
          <Link href="/v2/client/properties">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to properties
          </Link>
        </EButton>
        {/* Hero */}
        <ECard variant="ceremony" className="overflow-hidden">
          <div className="grid gap-0 md:grid-cols-[1.5fr_1fr]">
            <ECardBody className="space-y-2 pt-6">
              <EEyebrow>Property profile</EEyebrow>
              <h1 className="e-display-md">{property.name}</h1>
              <p className="text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">
                {property.address}, {property.suburb}, {property.state} {property.postcode}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <EBadge tone="primary" soft>
                  {property.bedrooms}bd · {property.bathrooms}ba
                </EBadge>
                {jobs.length > 0 ? (
                  <EBadge tone="gold" soft>{jobs.length} active service{jobs.length === 1 ? "" : "s"}</EBadge>
                ) : null}
              </div>
            </ECardBody>
            <div className="hidden items-center justify-center bg-[hsl(var(--e-primary))] p-6 md:flex">
              <div className="text-center text-[hsl(var(--e-primary-foreground))]">
                <Building2 className="mx-auto h-10 w-10 opacity-80" />
                <p className="e-serif mt-2 text-[1.25rem]">{property.suburb}</p>
                <p className="text-[0.75rem] opacity-70">{property.state} {property.postcode}</p>
              </div>
            </div>
          </div>
        </ECard>
      </div>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EStatCard
          label="Property setup"
          value={`${property.bedrooms}bd / ${property.bathrooms}ba`}
          icon={<Building2 className="h-4 w-4" />}
        />
        <EStatCard
          label="Upcoming / active"
          value={String(jobs.length)}
          delta="services on the books"
          deltaTone="neutral"
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <EStatCard
          label="Low stock items"
          value={String(lowStock.length)}
          delta={`${stocks.length} tracked`}
          deltaTone={lowStock.length > 0 ? "danger" : "neutral"}
          icon={<Package className="h-4 w-4" />}
        />
        <EStatCard
          label="Laundry updates"
          value={String(laundryTasks.length)}
          icon={<Shirt className="h-4 w-4" />}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          {/* Checklist status */}
          {portal.visibility.showChecklistPreview ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Checklist templates</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  Read-only preview of the active checklist assigned to this property.
                </p>
              </ECardHeader>
              <ECardBody className="space-y-4">
                {visibleChecklistTemplates.length === 0 ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                    No active checklist templates found.
                  </p>
                ) : (
                  visibleChecklistTemplates.map((template) => (
                    <div
                      key={`${template.jobType}-${template.id}`}
                      className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-[0.875rem] font-medium">{titleCase(template.jobType)}</p>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            {template.name} v{template.version} ·{" "}
                            {template.source === "property_override" ? "Property override" : "Global default"}
                          </p>
                        </div>
                        <EBadge tone="primary" soft>{template.sections.length} sections</EBadge>
                      </div>
                      <div className="space-y-3">
                        {template.sections.map((section) => (
                          <div
                            key={section.id}
                            className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-3"
                          >
                            <p className="text-[0.8125rem] font-medium">{section.label}</p>
                            <ul className="mt-2 space-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                              {section.fields.map((field) => (
                                <li key={field.id}>
                                  {field.label}
                                  {field.required ? " · required" : ""}
                                </li>
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

          {/* Inventory / amenities summary */}
          {portal.visibility.showInventory ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Inventory summary</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  Low stock and tracked inventory for this property.
                </p>
              </ECardHeader>
              <ECardBody className="space-y-2">
                {stocks.length === 0 ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                    No inventory tracked for this property.
                  </p>
                ) : lowStock.length > 0 ? (
                  lowStock.slice(0, 8).map((row, i) => (
                    <div key={row.id}>
                      {i > 0 ? <EThread className="my-1" /> : null}
                      <div className="flex items-center justify-between gap-2 py-1.5">
                        <div className="min-w-0">
                          <p className="text-[0.875rem] font-medium truncate">{row.item.name}</p>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            On hand {row.onHand} {row.item.unit} · threshold {row.reorderThreshold}
                          </p>
                        </div>
                        <EBadge tone="danger" soft>Low stock</EBadge>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                    No low stock items right now.
                  </p>
                )}
              </ECardBody>
            </ECard>
          ) : null}

          {/* Laundry schedule */}
          {portal.visibility.showLaundryUpdates ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Laundry schedule</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  Current laundry timeline — pickup, return, and image updates.
                </p>
              </ECardHeader>
              <ECardBody className="space-y-3">
                {laundryTasks.length === 0 ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                    No laundry updates for this property.
                  </p>
                ) : (
                  laundryTasks.slice(0, BRIEF_ROWS).map((task) => (
                    <div
                      key={task.id}
                      className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[0.875rem] font-medium">
                            {task.job.jobNumber ? `Job ${task.job.jobNumber}` : "Laundry task"} ·{" "}
                            {titleCase(task.job.jobType)}
                          </p>
                          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            Pickup {format(toZonedTime(task.pickupDate, TZ), "dd MMM yyyy")} · Drop off{" "}
                            {format(toZonedTime(task.dropoffDate, TZ), "dd MMM yyyy")}
                          </p>
                        </div>
                        <EBadge tone={statusTone(task.status)} soft>{titleCase(task.status)}</EBadge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {task.confirmations.map((confirmation) => (
                          <div
                            key={confirmation.id}
                            className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-3 text-[0.8125rem]"
                          >
                            <p className="font-medium">
                              {format(confirmation.createdAt, "dd MMM yyyy HH:mm")}
                            </p>
                            <p className="text-[hsl(var(--e-muted-foreground))]">
                              {getLaundryConfirmationLabel(confirmation)}
                              {confirmation.bagLocation ? ` · ${confirmation.bagLocation}` : ""}
                            </p>
                            {task.skipReasonCode ? (
                              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                                Reason: {titleCase(String(task.skipReasonCode))}
                              </p>
                            ) : null}
                            {task.skipReasonNote ? (
                              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                                {task.skipReasonNote}
                              </p>
                            ) : null}
                            {portal.visibility.showLaundryImages && confirmation.photoUrl ? (
                              <EMediaStrip
                                items={buildLaundryConfirmationMediaItems([confirmation])}
                                className="mt-2"
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
                <SeeAll href="/v2/client/laundry" total={laundryTasks.length} label="laundry" />
              </ECardBody>
            </ECard>
          ) : null}
        </div>

        <div className="space-y-6">
          {/* Upcoming jobs */}
          <ECard>
            <ECardHeader>
              <ECardTitle>Upcoming services</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Status-focused view of upcoming work at this property.
              </p>
            </ECardHeader>
            <ECardBody className="space-y-3">
              {jobs.length === 0 ? (
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  No active services scheduled right now.
                </p>
              ) : (
                jobs.slice(0, BRIEF_ROWS).map((job) => (
                  <div
                    key={job.id}
                    className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[0.875rem] font-medium">
                          {job.jobNumber ? `Job ${job.jobNumber}` : "Service"} · {titleCase(job.jobType)}
                        </p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {format(toZonedTime(job.scheduledDate, TZ), "EEE dd MMM yyyy")}
                          {job.startTime ? ` · ${job.startTime}` : ""}
                          {job.dueTime ? ` – ${job.dueTime}` : ""}
                        </p>
                      </div>
                      <EBadge tone={statusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
                    </div>
                    {portal.visibility.showCleanerNames && job.assignments.length > 0 ? (
                      <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        Assigned: {job.assignments.map((a) => a.user?.name || "Cleaner").join(", ")}
                      </p>
                    ) : null}
                    {job.priorityReason ? (
                      <p className="mt-2 text-[0.75rem] font-medium text-[hsl(var(--e-warning))]">
                        {job.priorityReason}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
              <SeeAll href="/v2/client/jobs" total={jobs.length} label="jobs" />
            </ECardBody>
          </ECard>

          {/* Recent reports */}
          {portal.visibility.showReports ? (
            <ECard>
              <ECardHeader>
                <ECardTitle>Recent reports</ECardTitle>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  Completed reports linked to this property.
                </p>
              </ECardHeader>
              <ECardBody className="space-y-3">
                {reports.length === 0 ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                    No reports available yet.
                  </p>
                ) : (
                  reports.slice(0, BRIEF_ROWS).map((report) => (
                    <div
                      key={report.id}
                      className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4"
                    >
                      <p className="text-[0.875rem] font-medium">
                        {report.job.jobNumber ? `Job ${report.job.jobNumber}` : "Report"} ·{" "}
                        {titleCase(report.job.jobType)}
                      </p>
                      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">
                        {format(toZonedTime(report.job.scheduledDate, TZ), "dd MMM yyyy")}
                      </p>
                      {portal.visibility.showReportDownloads ? (
                        <div className="mt-3">
                          <EReportDownloadButton jobId={report.job.id} />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
                <SeeAll href="/v2/client/reports" total={reports.length} label="reports" />
              </ECardBody>
            </ECard>
          ) : null}

          {/* Activity */}
          <ECard>
            <ECardHeader>
              <ECardTitle>Property activity</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Combined job, report, laundry, and task updates.
              </p>
            </ECardHeader>
            <ECardBody className="space-y-1">
              {activity.length === 0 ? (
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  No recent activity for this property.
                </p>
              ) : (
                activity.slice(0, BRIEF_ROWS).map((item, index) => (
                  <div key={`${item.type}-${index}-${item.at.toISOString()}`}>
                    {index > 0 ? <EThread className="my-1" /> : null}
                    <div className="py-1.5">
                      <div className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">
                        <CalendarDays className="h-3.5 w-3.5" />
                        <span className="tabular-nums">{format(item.at, "dd MMM yyyy HH:mm")}</span>
                      </div>
                      <p className="mt-1 text-[0.875rem] font-medium">{item.label}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.detail}</p>
                    </div>
                  </div>
                ))
              )}
            </ECardBody>
          </ECard>

          {/* Preferred cleaner (same PATCH endpoint as v1) */}
          <EPreferredCleanerCard
            propertyId={property.id}
            currentCleanerId={property.preferredCleanerUserId}
            options={preferredCleanerOptions}
          />

          {/* Condition timeline */}
          <ECard>
            <ECardHeader>
              <ECardTitle>Condition timeline</ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Visual history from previous cleans at this property.
              </p>
            </ECardHeader>
            <ECardBody className="space-y-4">
              {conditionTimeline.length === 0 ? (
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  No media history is available for this property yet.
                </p>
              ) : (
                // One card per VISIT, not per photo. Rendering each image as
                // its own card repeated the job header down the page and broke
                // a single clean's evidence into unrelated-looking fragments.
                groupTimelineByJob(conditionTimeline).slice(0, 2).map((group) => (
                  <div
                    key={group.jobId}
                    className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[0.875rem] font-medium">
                          {group.jobNumber ? `Job ${group.jobNumber}` : "Completed job"} ·{" "}
                          {titleCase(group.jobType)}
                        </p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">
                          {format(toZonedTime(group.scheduledDate, TZ), "EEE dd MMM yyyy")} ·{" "}
                          {group.items.length} item{group.items.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Link
                        href={`/v2/client/jobs/${group.jobId}`}
                        className="text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                      >
                        Open job
                      </Link>
                    </div>
                    <EMediaStrip
                      items={group.items.map((item) => ({
                        id: item.id,
                        url: item.url,
                        label: item.label || "Property history media",
                        mediaType: item.mediaType,
                      }))}
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
