"use client";

/** The side panel's tab contents. Every unknown is said in words. */
import Link from "next/link";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { sydneyRelativeDayLabel } from "@/lib/jobs/date-grouping";
import { sizeLabel } from "@/lib/properties/portfolio-options";
import { calendarDetail, historyStamp } from "@/lib/properties/portfolio-format";
import { jobHref, propertyHref } from "@/lib/properties/links";
import type { PropertyPreview, UpcomingJob } from "@/lib/properties/preview-types";

const SECTION = "flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5";
const EYEBROW = "text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]";

export function enumLabel(value: string): string {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusTone(status: string): EPillTone {
  if (status === "UNASSIGNED") return "warn";
  if (status === "OFFERED") return "warn";
  return "ok";
}

function laundryText(preview: PropertyPreview): string {
  if (!preview.laundry.enabled) return "No laundry service";
  if (preview.laundry.partners.length === 0) return "No partner allocated (every laundry account sees it)";
  return preview.laundry.partners
    .map((partner) => [partner.partnerName ?? partner.name, partner.turnaroundHours ? `${partner.turnaroundHours} h` : null].filter(Boolean).join(" · "))
    .join(", ");
}

function checklistText(preview: PropertyPreview): string {
  if (!preview.checklist) return "No active turnover form";
  const source = preview.checklist.source === "property_override" ? "property override" : "standard";
  return `${preview.checklist.name}, ${source} v${preview.checklist.version}`;
}

function JobLine({ job }: { job: UpcomingJob }) {
  return (
    <div className="flex items-center gap-2 text-[0.75rem]">
      <span className="e-tnum w-[90px] shrink-0">{sydneyRelativeDayLabel(job.dayKey)}</span>
      <span className="min-w-0 flex-1 truncate">
        <Link className="underline" href={jobHref(job.jobId)}>{job.jobNumber}</Link> · {enumLabel(job.jobType)}
        {job.cleaners.length > 0 ? ` · ${job.cleaners.join(", ")}` : ""}
      </span>
      <EPill tone={statusTone(job.status)}>{STATUS_LABELS[job.status] ?? enumLabel(job.status)}</EPill>
    </div>
  );
}

export function PreviewOverview({ preview, timeZone }: { preview: PropertyPreview; timeZone: string }) {
  const now = new Date();
  const access = [preview.access.lockbox ? `Lockbox: ${preview.access.lockbox}` : null, preview.access.codeRecorded ? "code in access guide" : "no code recorded"].filter(Boolean).join(", ");
  return (
    <>
      <dl className="grid grid-cols-[104px_1fr] gap-x-2.5 gap-y-1 text-[0.8125rem]">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Size</dt>
        <dd>{sizeLabel(preview.bedrooms, preview.bathrooms)}{preview.sofaBedCount > 0 ? ` · ${preview.sofaBedCount} sofa bed` : ""}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Checklist</dt>
        <dd>{checklistText(preview)}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Laundry</dt>
        <dd>{laundryText(preview)}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Calendar</dt>
        <dd>{preview.calendar.kind === "not-linked" ? "Not linked" : `iCal · ${calendarDetail(preview.calendar, now)}`}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Access</dt>
        <dd>{access}</dd>
      </dl>
      <section className={SECTION} aria-label="Next cleans">
        <div className="flex items-center justify-between gap-2">
          <span className={EYEBROW}>Next cleans</span>
          <Link className="text-[0.75rem] underline" href="/v2/admin/calendar">Calendar</Link>
        </div>
        {preview.upcoming.length === 0 ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">None booked.</span> : preview.upcoming.map((job) => <JobLine key={job.jobId} job={job} />)}
      </section>
      <section className={SECTION} aria-label="Property care due">
        <div className="flex items-center justify-between gap-2">
          <span className={EYEBROW}>Property care due</span>
          {preview.care.length > 0 ? <EPill tone="warn">{preview.care.length} due</EPill> : null}
        </div>
        <PreviewCareList preview={preview} />
      </section>
      <section className={SECTION} aria-label="Recent">
        <span className={EYEBROW}>Recent</span>
        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {preview.recent.length === 0 ? "Nothing recorded yet." : preview.recent.map((event) => `${historyStamp(event.at, timeZone)} ${event.text}`).join(" · ")}
        </span>
      </section>
    </>
  );
}

function PreviewCareList({ preview }: { preview: PropertyPreview }) {
  if (preview.care.length === 0) return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Nothing due.</span>;
  return (
    <>
      {preview.care.map((item) => (
        <span key={item.id} className="text-[0.75rem]">
          {item.title}
          {item.due ? ` · due ${item.due}` : ""}
          {item.plannedDayKey ? ` · runs as a task in ${item.jobNumber ?? "the clean"} on ${sydneyRelativeDayLabel(item.plannedDayKey)}` : " · waiting for a suitable clean"}
        </span>
      ))}
    </>
  );
}

export function PreviewJobs({ preview }: { preview: PropertyPreview }) {
  return (
    <>
      <section className={SECTION} aria-label="Upcoming jobs">
        <span className={EYEBROW}>Upcoming</span>
        {preview.upcoming.length === 0 ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">None booked.</span> : preview.upcoming.map((job) => <JobLine key={job.jobId} job={job} />)}
      </section>
      <section className={SECTION} aria-label="Recent jobs">
        <span className={EYEBROW}>Recently finished</span>
        {preview.recentJobs.length === 0 ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No finished jobs yet.</span> : preview.recentJobs.map((job) => <JobLine key={job.jobId} job={job} />)}
      </section>
      <Link className="text-[0.8125rem] underline" href={propertyHref(preview.id, "jobs")}>All jobs and history</Link>
    </>
  );
}

export function PreviewCare({ preview }: { preview: PropertyPreview }) {
  return (
    <>
      <section className={SECTION} aria-label="Open care tasks"><span className={EYEBROW}>Open care tasks</span><PreviewCareList preview={preview} /></section>
      <Link className="text-[0.8125rem] underline" href={propertyHref(preview.id, "care")}>Care and planning</Link>
    </>
  );
}

export function PreviewAccess({ preview }: { preview: PropertyPreview }) {
  const row = (label: string, value: string | null) => (
    <>
      <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd>{value ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</dd>
    </>
  );
  return (
    <>
      <dl className="grid grid-cols-[104px_1fr] gap-x-2.5 gap-y-1 text-[0.8125rem]">
        {row("Lockbox", preview.access.lockbox)}
        {row("Door code", preview.access.codeRecorded ? "Recorded (shown on the property page)" : null)}
        {row("Parking", preview.access.parking)}
        {row("Instructions", preview.access.instructions)}
      </dl>
      <Link className="text-[0.8125rem] underline" href={propertyHref(preview.id, "access")}>Access guide, {preview.access.guideSteps} {preview.access.guideSteps === 1 ? "step" : "steps"}</Link>
    </>
  );
}
