/**
 * Overview tab of the client property page (board 2): next clean, preferred
 * cleaner, then one summary card per topic linking to its tab. Server-renderable.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { EBadge, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EPreferredCleanerCard } from "@/components/v2/client/properties/property-actions";
import type { PropertyDetail } from "@/components/v2/client/property/property-sections";
import { propertyTitleCase, sydneyText } from "@/components/v2/client/property/property-format";
import { clientLaundryStatusLabel, clientLaundryStatusTone } from "@/lib/client/laundry-status";

export interface OverviewFlags {
  showReports: boolean;
  showInventory: boolean;
  showLaundry: boolean;
  showNames: boolean;
  showChecklistPreview: boolean;
}

function SummaryCard({ title, badge, href, children }: { title: string; badge?: ReactNode; href: string; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} className="block rounded-[var(--e-radius-lg)] focus-visible:outline focus-visible:outline-2">
      <ECard className="p-3 hover:bg-[hsl(var(--e-muted))]">
        <div className="flex items-center justify-between gap-2"><span className="text-[0.875rem] font-semibold">{title}</span>{badge}</div>
        <div className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{children}</div>
      </ECard>
    </Link>
  );
}

export function PropertyOverview({ detail, flags, tabHref }: { detail: PropertyDetail; flags: OverviewFlags; tabHref: (tab: string) => string }) {
  const next = detail.jobs[0] ?? null;
  const nextNames = flags.showNames && next ? next.assignments.map((a) => a.user?.name).filter(Boolean).join(" & ") : "";
  const low = detail.stocks.filter((row) => Number(row.onHand) <= Number(row.reorderThreshold));
  const lastReport = detail.reports[0] ?? null;
  const laundry = detail.laundryTasks[0] ?? null;
  return (
    <div className="space-y-3">
      <ECard className="overflow-hidden">
        {next ? (
          <Link href={`/v2/client/jobs/${next.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--e-muted))]">
            <span className="min-w-0 flex-1">
              <span className="block text-[0.875rem] font-semibold">Next clean</span>
              <span className="block text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {[sydneyText(next.scheduledDate, "EEE d MMM"), next.startTime, nextNames || null, propertyTitleCase(next.status)].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span aria-hidden className="text-[hsl(var(--e-muted-foreground))]">›</span>
          </Link>
        ) : <p className="px-4 py-3 text-[0.875rem]">No upcoming clean scheduled</p>}
      </ECard>
      <EPreferredCleanerCard propertyId={detail.property.id} currentCleanerId={detail.property.preferredCleanerUserId} options={detail.preferredCleanerOptions} />

      <div className="grid gap-3 sm:grid-cols-2">
        {flags.showReports ? (
          <SummaryCard title="Reports" href={tabHref("reports")} badge={<span className="text-[0.75rem] underline">All {detail.reports.length}</span>}>
            {lastReport ? `${sydneyText(lastReport.job.scheduledDate, "EEE d MMM")} · ${propertyTitleCase(lastReport.job.jobType)}` : "No reports yet"}
          </SummaryCard>
        ) : null}
        {flags.showInventory ? (
          <SummaryCard title="Stock" href={tabHref("stock")} badge={detail.stocks.length > 0 ? <EBadge tone={low.length > 0 ? "warning" : "success"} soft>{low.length > 0 ? `${low.length} low` : "Topped up"}</EBadge> : undefined}>
            {detail.stocks.length === 0 ? "No inventory tracked" : low.length > 0
              ? low.slice(0, 3).map((row) => `${row.item.name} ${row.onHand} of ${row.parLevel}`).join(" · ")
              : `${detail.stocks.length} items tracked`}
          </SummaryCard>
        ) : null}
        {flags.showLaundry ? (
          <SummaryCard title="Laundry" href={tabHref("laundry")} badge={laundry ? <EBadge tone={clientLaundryStatusTone(laundry.status)} soft>{clientLaundryStatusLabel(laundry.status)}</EBadge> : undefined}>
            {laundry ? `Pickup ${sydneyText(laundry.pickupDate, "EEE d MMM")} · back ${sydneyText(laundry.dropoffDate, "EEE d MMM")}` : "No laundry updates"}
          </SummaryCard>
        ) : null}
        <SummaryCard title="Property care" href={tabHref("care")}>Planned and completed extra care for this home</SummaryCard>
      </div>

      {flags.showChecklistPreview ? <ChecklistPreview detail={detail} /> : null}
    </div>
  );
}

function ChecklistPreview({ detail }: { detail: PropertyDetail }) {
  // Only the job types this property actually gets; a new home with no jobs shows all.
  const activeTypes = new Set(detail.jobs.map((job) => job.jobType));
  const templates = activeTypes.size > 0 ? detail.checklistTemplates.filter((template) => activeTypes.has(template.jobType)) : detail.checklistTemplates;
  return (
    <ECard>
      <details>
        <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[0.875rem] font-semibold">Checklist templates ({templates.length})</summary>
        <ECardHeader className="pt-0"><ECardTitle className="sr-only">Checklist templates</ECardTitle><p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Read-only preview of the active checklist assigned to this property.</p></ECardHeader>
        <ECardBody className="space-y-4">
          {templates.length === 0 ? <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No active checklist templates found.</p> : templates.map((template) => (
            <div key={`${template.jobType}-${template.id}`} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[0.875rem] font-medium">{propertyTitleCase(template.jobType)}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{template.name} v{template.version} · {template.source === "property_override" ? "Property override" : "Global default"}</p>
                </div>
                <EBadge tone="primary" soft>{template.sections.length} sections</EBadge>
              </div>
              <div className="space-y-3">
                {template.sections.map((section) => (
                  <div key={section.id} className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-3">
                    <p className="text-[0.8125rem] font-medium">{section.label}</p>
                    <ul className="mt-2 space-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      {section.fields.map((field) => <li key={field.id}>{field.label}{field.required ? " · required" : ""}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </ECardBody>
      </details>
    </ECard>
  );
}
