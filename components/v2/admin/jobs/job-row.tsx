"use client";

/**
 * ESTATE jobs workspace — shared row facts and the board card.
 *
 * The list itself is a table (`jobs-table.tsx`); this file keeps the helpers
 * every Jobs surface uses (labels, tones, names, flags) and the board card.
 * A card opens the peek panel like a table row does; the full job is one
 * click further ("Open full job").
 */
import type { DragEvent } from "react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { UserRound } from "lucide-react";
import { JOB_STATUS_TONES, statusTintStyle } from "@/lib/jobs/status-presentation";
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { JobStatusIcon } from "@/components/shared/job-status-icon";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { JobListRow } from "./jobs-query";

const TZ = "Australia/Sydney";

export type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";
export { STATUS_LABELS };
export const STATUS_TONES: Record<string, Tone> = JOB_STATUS_TONES;

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? "neutral";
}

const PILL_TONE: Record<Tone, EPillTone> = {
  neutral: "neutral", primary: "info", gold: "gold", success: "ok", warning: "warn", danger: "bad", info: "info", aubergine: "neutral",
};

/**
 * Jobs-surface override of the shared tones: the approved Jobs design draws
 * "Unassigned" in the danger tone. The shared `JOB_STATUS_TONES` (used by
 * other portals) is unchanged; only the Jobs list, board and peek read this.
 */
export const JOBS_PILL_TONE_OVERRIDES: Readonly<Record<string, EPillTone>> = { UNASSIGNED: "bad" };

export function jobsPillTone(status: string): EPillTone {
  return JOBS_PILL_TONE_OVERRIDES[status] ?? PILL_TONE[statusTone(status)];
}

/** The status pill: written status (never colour alone), tone as drawn for Jobs. */
export function JobStatusPill({ status }: { status: string }) {
  return <EPill tone={jobsPillTone(status)}>{statusLabel(status)}</EPill>;
}

export function scheduledLabel(value: unknown, pattern = "EEE dd MMM"): string {
  if (!value) return "No date";
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) return "No date";
  return format(toZonedTime(parsed, TZ), pattern);
}

type NamedAssignments = { assignments?: Array<{ user?: { name?: string | null; email?: string | null } | null }> | null };

export function assignmentNames(job: NamedAssignments): string[] {
  const names = Array.isArray(job?.assignments)
    ? job.assignments.map((a) => a?.user?.name?.trim() || a?.user?.email?.trim() || "").filter(Boolean)
    : [];
  return Array.from(new Set<string>(names));
}

export function jobTypeLabel(value: string | null | undefined): string {
  if (!value) return "Job";
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "10:00 – 14:00", "From 10:00", "Due 14:00" or "Time not set". */
export function timeWindowLabel(job: Pick<JobListRow, "startTime" | "endTime" | "dueTime">): string {
  const end = job.endTime || job.dueTime;
  if (job.startTime && end) return `${job.startTime} – ${end}`;
  if (job.startTime) return `From ${job.startTime}`;
  if (job.dueTime) return `Due ${job.dueTime}`;
  return "Time not set";
}

/** Quick assign is offered only where it applies: nobody on it and not skipped. */
export function canQuickAssign(job: Pick<JobListRow, "status" | "cleanSkipStatus">): boolean {
  return job.status === "UNASSIGNED" && String(job.cleanSkipStatus ?? "") !== "SKIPPED";
}

export function FlagPills({ job }: { job: JobListRow }) {
  const hasPayRequest = Array.isArray(job.payAdjustments) && job.payAdjustments.length > 0;
  const hasDamage = Array.isArray(job.issueTickets) && job.issueTickets.length > 0;
  const skip = String(job.cleanSkipStatus ?? "");
  // Server-computed timing-rule chips from /api/jobs (`timingBadges`).
  const earlyTime = typeof job.timingBadges?.early === "string" ? job.timingBadges.early : "";
  const lateTime = typeof job.timingBadges?.late === "string" ? job.timingBadges.late : "";
  return (
    <>
      {earlyTime ? <EBadge tone="warning" soft>{`EARLY ${earlyTime}`}</EBadge> : null}
      {lateTime ? <EBadge tone="info" soft>{`LATE ${lateTime}`}</EBadge> : null}
      {job.isRework ? <EBadge tone="aubergine" soft>Rework</EBadge> : null}
      {hasPayRequest ? <EBadge tone="info" soft>Pay request</EBadge> : null}
      {hasDamage ? <EBadge tone="danger" soft>Damage</EBadge> : null}
      {skip === "REQUESTED" ? <EBadge tone="warning" soft>Skip requested</EBadge> : null}
      {skip === "SKIPPED" ? <EBadge tone="danger" soft>Skipped</EBadge> : null}
    </>
  );
}

/** Estate checkbox — a hairline square that fills gold when checked. */
export function ECheck({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? "Select"}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[var(--e-radius-xs)] border transition-colors duration-[160ms] " +
        (checked
          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-gold))]")
      }
    >
      {checked ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="hsl(var(--e-gold-foreground))" strokeWidth="2">
          <path d="M2 6.5 4.8 9 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

export type JobsDensityValue = "compact" | "default" | "comfortable";

type BoardCardProps = {
  job: JobListRow;
  density?: JobsDensityValue;
  selected: boolean;
  active?: boolean;
  onToggleSelect: (jobId: string) => void;
  onOpen: (job: JobListRow) => void;
  onQuickAssign: (job: JobListRow) => void;
  menuItems: ERowMenuItem[];
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>, job: JobListRow) => void;
};

/** Board card — the same facts as a row, compact. Opens the peek panel. */
export function EBoardCard({ job, density = "default", selected, active = false, onToggleSelect, onOpen, onQuickAssign, menuItems, draggable = false, onDragStart }: BoardCardProps) {
  const cleaners = assignmentNames(job);
  const status = String(job.status ?? "");
  const propertyName = job.property?.name ?? "Unknown property";
  const padding = density === "compact" ? "p-2.5" : density === "comfortable" ? "p-5" : "p-3.5";
  return (
    <article
      draggable={draggable}
      onDragStart={draggable && onDragStart ? (event) => onDragStart(event, job) : undefined}
      data-active={active || undefined}
      style={statusTintStyle(status)}
      className={`rounded-[var(--e-radius)] border bg-[hsl(var(--e-surface))] ${padding} ${active ? "border-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border))]"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <JobStatusIcon status={status} />
        <button
          type="button"
          onClick={() => onOpen(job)}
          className="e-serif min-w-0 flex-1 truncate text-left text-[0.9375rem] font-[520] leading-snug hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
        >
          <span className="sr-only">Preview </span>{propertyName}
        </button>
        <ECheck checked={selected} onChange={() => onToggleSelect(job.id)} label={`Select ${propertyName}`} />
      </div>
      <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {[job.property?.suburb, job.property?.client?.name].filter(Boolean).join(" · ")}
      </p>
      <p className="e-tnum mt-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        {scheduledLabel(job.scheduledDate, "dd MMM")} · {timeWindowLabel(job)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <JobStatusPill status={status} />
        <FlagPills job={job} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-2.5">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          <UserRound aria-hidden className="h-3 w-3 shrink-0 text-[hsl(var(--e-text-faint))]" />
          {cleaners.length > 0 ? cleaners.join(", ") : <span className="text-[hsl(var(--e-text-faint))]">Unassigned</span>}
        </p>
        <span className="flex items-center gap-1">
          {canQuickAssign(job) ? <EButton size="sm" variant="outline" onClick={() => onQuickAssign(job)}>Assign</EButton> : null}
          <ERowMenu label={`More actions for ${propertyName}`} items={menuItems} />
        </span>
      </div>
    </article>
  );
}
