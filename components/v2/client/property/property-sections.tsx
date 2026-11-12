/**
 * Sections of the client property page (board 2: Overview, Reports, Photos,
 * Stock, Laundry, Care). The cards are the ones the page already had; each tab
 * now holds one topic. Server-renderable; data arrives already filtered by the
 * visibility switches in `getClientPropertyDetailForUser`.
 */
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { getClientPropertyDetailForUser } from "@/lib/client/portal-data";
import { buildLaundryConfirmationMediaItems, getLaundryConfirmationLabel } from "@/lib/laundry/media";
import { EBadge, ECard, ECardBody, ECardHeader, ECardTitle, EThread } from "@/components/v2/ui/primitives";
import { EMediaStrip } from "@/components/v2/client/properties/media-strip";
import { EReportDownloadButton } from "@/components/v2/client/properties/property-actions";
import { groupTimelineByJob, propertyStatusTone, propertyTitleCase, sydneyText, type TimelineMedia } from "@/components/v2/client/property/property-format";

export type PropertyDetail = NonNullable<Awaited<ReturnType<typeof getClientPropertyDetailForUser>>>;

const muted = "text-[0.875rem] text-[hsl(var(--e-muted-foreground))]";

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <div className="pt-2">
      <Link href={href} className="inline-flex min-h-11 items-center text-[0.8125rem] font-[600] text-[hsl(var(--e-gold-ink))] hover:underline">{label} →</Link>
    </div>
  );
}

export function ReportsSection({ detail, showDownloads, limit }: { detail: PropertyDetail; showDownloads: boolean; limit: number }) {
  return (
    <ECard>
      <ECardHeader><ECardTitle>Reports</ECardTitle><p className={muted}>Completed reports for this property.</p></ECardHeader>
      <ECardBody className="space-y-3">
        {detail.reports.length === 0 ? <p className={muted}>No reports available yet.</p> : detail.reports.slice(0, limit).map((report) => (
          <div key={report.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
            <div>
              <p className="text-[0.875rem] font-medium">{sydneyText(report.job.scheduledDate, "EEE d MMM")} · {propertyTitleCase(report.job.jobType)}</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{report.job.jobNumber ? `Job ${report.job.jobNumber}` : "Report"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/v2/client/jobs/${report.job.id}#job-report`} className="inline-flex min-h-11 items-center px-2 text-[0.8125rem] underline">Open</Link>
              {showDownloads ? <EReportDownloadButton jobId={report.job.id} /> : null}
            </div>
          </div>
        ))}
        <SeeAll href={`/v2/client/reports?propertyId=${detail.property.id}`} label={`All ${detail.reports.length} reports`} />
      </ECardBody>
    </ECard>
  );
}

export function StockSection({ detail }: { detail: PropertyDetail }) {
  const low = detail.stocks.filter((row) => Number(row.onHand) <= Number(row.reorderThreshold));
  return (
    <ECard>
      <ECardHeader><ECardTitle>Stock</ECardTitle><p className={muted}>Low stock and tracked inventory for this property.</p></ECardHeader>
      <ECardBody className="space-y-2">
        {detail.stocks.length === 0 ? <p className={muted}>No inventory tracked for this property.</p>
          : low.length === 0 ? <p className={muted}>No low stock items right now. {detail.stocks.length} items tracked.</p>
          : low.map((row, i) => (
            <div key={row.id}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] font-medium">{row.item.name}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">On hand {row.onHand} {row.item.unit} · threshold {row.reorderThreshold}</p>
                </div>
                <EBadge tone="danger" soft>Low stock</EBadge>
              </div>
            </div>
          ))}
        <SeeAll href="/v2/client/inventory" label="Open inventory" />
      </ECardBody>
    </ECard>
  );
}

export function LaundrySection({ detail, showImages, limit }: { detail: PropertyDetail; showImages: boolean; limit: number }) {
  return (
    <ECard>
      <ECardHeader><ECardTitle>Laundry</ECardTitle><p className={muted}>Pickup, return and image updates.</p></ECardHeader>
      <ECardBody className="space-y-3">
        {detail.laundryTasks.length === 0 ? <p className={muted}>No laundry updates for this property.</p> : detail.laundryTasks.slice(0, limit).map((task) => (
          <div key={task.id} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[0.875rem] font-medium">{task.job.jobNumber ? `Job ${task.job.jobNumber}` : "Laundry task"} · {propertyTitleCase(task.job.jobType)}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Pickup {sydneyText(task.pickupDate, "dd MMM yyyy")} · Drop off {sydneyText(task.dropoffDate, "dd MMM yyyy")}
                </p>
              </div>
              <EBadge tone={propertyStatusTone(task.status)} soft>{propertyTitleCase(task.status)}</EBadge>
            </div>
            <div className="mt-3 space-y-2">
              {task.confirmations.map((confirmation) => (
                <div key={confirmation.id} className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-3 text-[0.8125rem]">
                  <p className="font-medium">{sydneyText(confirmation.createdAt, "dd MMM yyyy HH:mm")}</p>
                  <p className="text-[hsl(var(--e-muted-foreground))]">
                    {getLaundryConfirmationLabel(confirmation)}{confirmation.bagLocation ? ` · ${confirmation.bagLocation}` : ""}
                  </p>
                  {task.skipReasonCode ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Reason: {propertyTitleCase(String(task.skipReasonCode))}</p> : null}
                  {task.skipReasonNote ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{task.skipReasonNote}</p> : null}
                  {showImages && confirmation.photoUrl ? <EMediaStrip items={buildLaundryConfirmationMediaItems([confirmation])} className="mt-2" /> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
        <SeeAll href="/v2/client/laundry" label="All laundry" />
      </ECardBody>
    </ECard>
  );
}

export function PhotosSection({ detail, limit }: { detail: PropertyDetail; limit: number }) {
  const groups = groupTimelineByJob(detail.conditionTimeline as TimelineMedia[]);
  return (
    <ECard>
      <ECardHeader><ECardTitle>Photos</ECardTitle><p className={muted}>Visual history from previous cleans at this property.</p></ECardHeader>
      <ECardBody className="space-y-4">
        {groups.length === 0 ? <p className={muted}>No media history is available for this property yet.</p> : groups.slice(0, limit).map((group) => (
          <div key={group.jobId} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[0.875rem] font-medium">{group.jobNumber ? `Job ${group.jobNumber}` : "Completed job"} · {propertyTitleCase(group.jobType)}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">
                  {sydneyText(group.scheduledDate, "EEE dd MMM yyyy")} · {group.items.length} item{group.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <Link href={`/v2/client/jobs/${group.jobId}`} className="inline-flex min-h-11 items-center text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline">Open job</Link>
            </div>
            <EMediaStrip items={group.items.map((item) => ({ id: item.id, url: item.url, label: item.label || "Property history media", mediaType: item.mediaType }))} />
          </div>
        ))}
      </ECardBody>
    </ECard>
  );
}

export function UpcomingSection({ detail, showNames, limit }: { detail: PropertyDetail; showNames: boolean; limit: number }) {
  return (
    <ECard>
      <ECardHeader><ECardTitle>Upcoming services</ECardTitle></ECardHeader>
      <ECardBody className="space-y-3">
        {detail.jobs.length === 0 ? <p className={muted}>No active services scheduled right now.</p> : detail.jobs.slice(0, limit).map((job) => (
          <Link key={job.id} href={`/v2/client/jobs/${job.id}`} className="block rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3 hover:bg-[hsl(var(--e-muted))]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[0.875rem] font-medium">{job.jobNumber ? `Job ${job.jobNumber}` : "Service"} · {propertyTitleCase(job.jobType)}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {sydneyText(job.scheduledDate, "EEE dd MMM yyyy")}{job.startTime ? ` · ${job.startTime}` : ""}{job.dueTime ? ` – ${job.dueTime}` : ""}
                </p>
              </div>
              <EBadge tone={propertyStatusTone(job.status)} soft>{propertyTitleCase(job.status)}</EBadge>
            </div>
            {showNames && job.assignments.length > 0 ? (
              <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Assigned: {job.assignments.map((a) => a.user?.name || "Cleaner").join(", ")}</p>
            ) : null}
            {job.priorityReason ? <p className="mt-2 text-[0.75rem] font-medium text-[hsl(var(--e-warning))]">{job.priorityReason}</p> : null}
          </Link>
        ))}
        {detail.jobs.length > limit ? <SeeAll href="/v2/client/jobs" label={`See all ${detail.jobs.length} jobs`} /> : null}
      </ECardBody>
    </ECard>
  );
}

export function ActivitySection({ detail, limit }: { detail: PropertyDetail; limit: number }) {
  return (
    <ECard>
      <ECardHeader><ECardTitle>Property activity</ECardTitle><p className={muted}>Combined job, report, laundry, and task updates.</p></ECardHeader>
      <ECardBody className="space-y-1">
        {detail.activity.length === 0 ? <p className={muted}>No recent activity for this property.</p> : detail.activity.slice(0, limit).map((item, index) => (
          <div key={`${item.type}-${index}-${item.at.toISOString()}`}>
            {index > 0 ? <EThread className="my-1" /> : null}
            <div className="py-1.5">
              <div className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="tabular-nums">{sydneyText(item.at, "dd MMM yyyy HH:mm")}</span>
              </div>
              <p className="mt-1 text-[0.875rem] font-medium">{item.label}</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.detail}</p>
            </div>
          </div>
        ))}
      </ECardBody>
    </ECard>
  );
}
