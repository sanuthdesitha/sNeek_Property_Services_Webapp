"use client";

/**
 * ESTATE jobs workspace — row + board card presentation.
 * Pure Estate language: hairline dividers, serif property names, e-numeral
 * money, EBadge status pills. Data comes straight from /api/jobs rows.
 */
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { CalendarDays, Settings2, UserRound, UserRoundPlus } from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";

const TZ = "Australia/Sydney";

export type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

export const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  OFFERED: "Awaiting confirmation",
  ASSIGNED: "Assigned",
  EN_ROUTE: "On the way",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  WAITING_CONTINUATION_APPROVAL: "Waiting approval",
  SUBMITTED: "Submitted",
  QA_REVIEW: "QA review",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
};

export const STATUS_TONES: Record<string, Tone> = {
  UNASSIGNED: "warning",
  OFFERED: "warning",
  ASSIGNED: "primary",
  EN_ROUTE: "info",
  IN_PROGRESS: "info",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "danger",
  SUBMITTED: "aubergine",
  QA_REVIEW: "aubergine",
  COMPLETED: "success",
  INVOICED: "gold",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? "neutral";
}

export function scheduledLabel(value: unknown, pattern = "EEE dd MMM"): string {
  if (!value) return "No date";
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) return "No date";
  return format(toZonedTime(parsed, TZ), pattern);
}

export function assignmentNames(job: any): string[] {
  const names = Array.isArray(job?.assignments)
    ? job.assignments
        .map((a: any) => a?.user?.name?.trim() || a?.user?.email?.trim() || "")
        .filter(Boolean)
    : [];
  return Array.from(new Set<string>(names));
}

export function moneyLabel(job: any): string | null {
  const value = Number(job?.fixedPrice);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `$${value.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function FlagPills({ job }: { job: any }) {
  const hasPayRequest = Array.isArray(job?.payAdjustments) && job.payAdjustments.length > 0;
  const hasDamage = Array.isArray(job?.issueTickets) && job.issueTickets.length > 0;
  const skip = String(job?.cleanSkipStatus ?? "");
  // Server-computed timing-rule chips from /api/jobs (`timingBadges`):
  // early = "finish before HH:MM" (early check-in), late = "start after HH:MM"
  // (late checkout). Only present when the admin rule is enabled.
  const earlyTime = typeof job?.timingBadges?.early === "string" ? job.timingBadges.early : "";
  const lateTime = typeof job?.timingBadges?.late === "string" ? job.timingBadges.late : "";
  return (
    <>
      {earlyTime ? <EBadge tone="warning" soft>{`EARLY ${earlyTime}`}</EBadge> : null}
      {lateTime ? <EBadge tone="info" soft>{`LATE ${lateTime}`}</EBadge> : null}
      {job?.isRework ? <EBadge tone="aubergine" soft>Rework</EBadge> : null}
      {hasPayRequest ? <EBadge tone="info" soft>Pay request</EBadge> : null}
      {hasDamage ? <EBadge tone="danger" soft>Damage</EBadge> : null}
      {skip === "REQUESTED" ? <EBadge tone="warning" soft>Skip requested</EBadge> : null}
      {skip === "SKIPPED" ? <EBadge tone="danger" soft>Skipped</EBadge> : null}
    </>
  );
}

/** Estate checkbox — a hairline square that fills gold when checked. */
export function ECheck({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
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

type RowProps = {
  job: any;
  selected: boolean;
  onToggleSelect: (jobId: string) => void;
  onQuickAssign: (job: any) => void;
  onManage?: (job: any) => void;
};

/** List row: property (serif) · client · cleaner · time · status · money. */
/**
 * One job in the list.
 *
 * The grid declares SEVEN columns and renders SEVEN children. It used to
 * render eight, so the actions block wrapped onto a second grid row under the
 * checkbox — invisible at lg (those buttons are opacity-0 until hover) but
 * still occupying a full row's height. That was the dead space beside every
 * job and the reason rows stood twice as tall as their content.
 *
 * The property name is what an admin scans for, so it takes the flexible
 * column and wraps rather than truncating. "Jackson-Pr…" is not an identifier.
 * Everything that must still truncate carries a title attribute, so the full
 * value is one hover away.
 */
export function EJobRow({ job, selected, onToggleSelect, onQuickAssign, onManage }: RowProps) {
  const router = useRouter();
  const cleaners = assignmentNames(job);
  const clientName = job?.property?.client?.name ?? job?.client?.name ?? "—";
  const money = moneyLabel(job);
  const status = String(job?.status ?? "");
  const propertyName = job?.property?.name ?? "Unknown property";
  const cleanerLabel = cleaners.length > 0 ? cleaners.join(", ") : "";

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/v2/admin/jobs/${job.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter") router.push(`/v2/admin/jobs/${job.id}`);
      }}
      className={
        "group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-4 py-3 " +
        "transition-colors duration-[160ms] hover:bg-[hsl(var(--e-muted)/0.6)] sm:px-5 " +
        "md:grid-cols-[auto_minmax(0,1fr)_9rem_9rem_6rem_auto_auto] md:items-center md:gap-x-5"
      }
    >
      <ECheck
        checked={selected}
        onChange={() => onToggleSelect(job.id)}
        label={`Select ${propertyName}`}
      />

      {/* Property — the identifier, so it gets the room and never truncates */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="e-serif text-[1rem] font-[520] leading-snug [overflow-wrap:anywhere]">
            {propertyName}
          </p>
          {job?.jobNumber ? (
            <span className="e-tnum shrink-0 text-[0.6875rem] tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
              {job.jobNumber}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {[job?.property?.suburb, String(job?.jobType ?? "").replace(/_/g, " ").toLowerCase()]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {/* Mobile carries what the desktop columns show */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] md:hidden">
          <span className="inline-flex items-center gap-1 rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))] px-1.5 py-0.5 text-[hsl(var(--e-text-secondary))]">
            <CalendarDays className="h-3 w-3 shrink-0 text-[hsl(var(--e-text-faint))]" aria-hidden />
            <span className="e-tnum">{scheduledLabel(job?.scheduledDate)}</span>
            {job?.startTime ? (
              <span className="e-tnum text-[hsl(var(--e-text-faint))]">· {job.startTime}</span>
            ) : null}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1 text-[hsl(var(--e-text-secondary))]">
            <UserRound className="h-3 w-3 shrink-0 text-[hsl(var(--e-text-faint))]" aria-hidden />
            <span className="truncate" title={cleanerLabel || undefined}>
              {cleanerLabel || (
                <span className="text-[hsl(var(--e-text-faint))]">Unassigned</span>
              )}
            </span>
          </span>
          <span className="truncate text-[hsl(var(--e-text-faint))]" title={clientName}>
            {clientName}
          </span>
          {money ? (
            <span className="e-numeral text-[hsl(var(--e-text-secondary))]">{money}</span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
          <FlagPills job={job} />
        </div>
      </div>

      {/* Client */}
      <div className="hidden min-w-0 md:block">
        <p className="e-eyebrow text-[0.5625rem]">Client</p>
        <p
          className="truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))]"
          title={clientName}
        >
          {clientName}
        </p>
      </div>

      {/* Cleaner */}
      <div className="hidden min-w-0 md:block">
        <p className="e-eyebrow text-[0.5625rem]">Cleaner</p>
        <p
          className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]"
          title={cleanerLabel || undefined}
        >
          <UserRound className="h-3 w-3 shrink-0 text-[hsl(var(--e-text-faint))]" />
          <span className="truncate">
            {cleanerLabel || (
              <span className="text-[hsl(var(--e-text-faint))]">Unassigned</span>
            )}
          </span>
        </p>
      </div>

      {/* When + money, one column so the grid stays at seven */}
      <div className="hidden text-right md:block">
        <p className="e-tnum text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          {scheduledLabel(job?.scheduledDate)}
        </p>
        <p className="e-tnum text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {job?.startTime ?? "—"}
        </p>
        {money ? (
          <p className="e-numeral mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {money}
          </p>
        ) : null}
      </div>

      {/* Status */}
      <div className="col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-auto">
        <EBadge tone={statusTone(status)} soft>
          {statusLabel(status)}
        </EBadge>
      </div>

      {/* Actions — reserved width so the row does not reflow on hover */}
      <div
        className="col-span-2 flex items-center justify-end gap-2 md:col-span-1 md:min-w-[9rem]"
        onClick={(event) => event.stopPropagation()}
      >
        {status === "UNASSIGNED" && String(job?.cleanSkipStatus ?? "") !== "SKIPPED" ? (
          <EButton size="sm" variant="outline-gold" onClick={() => onQuickAssign(job)}>
            <UserRoundPlus className="h-3.5 w-3.5" />
            Assign
          </EButton>
        ) : null}
        {onManage ? (
          <EButton
            size="sm"
            variant="ghost"
            aria-label={`Manage ${propertyName}`}
            className="opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
            onClick={() => onManage(job)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Manage
          </EButton>
        ) : null}
        <EButton
          size="sm"
          variant="ghost"
          className="opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          onClick={() => router.push(`/v2/admin/jobs/${job.id}`)}
        >
          Open
        </EButton>
      </div>
    </div>
  );
}

/** Board card — compact ceremony of the same facts. */
export function EBoardCard({ job, selected, onToggleSelect, onQuickAssign, onManage }: RowProps) {
  const router = useRouter();
  const cleaners = assignmentNames(job);
  const money = moneyLabel(job);
  const status = String(job?.status ?? "");

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/v2/admin/jobs/${job.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter") router.push(`/v2/admin/jobs/${job.id}`);
      }}
      className="cursor-pointer rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5 transition-shadow duration-[160ms] hover:shadow-[var(--e-elevation-2)]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="e-serif min-w-0 truncate text-[0.9375rem] font-[520] leading-snug">
          {job?.property?.name ?? "Unknown property"}
        </p>
        <ECheck checked={selected} onChange={() => onToggleSelect(job.id)} label={`Select ${job?.property?.name ?? "job"}`} />
      </div>
      <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {[job?.property?.suburb, job?.property?.client?.name ?? job?.client?.name].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="e-tnum text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          {scheduledLabel(job?.scheduledDate, "dd MMM")}
          {job?.startTime ? ` · ${job.startTime}` : ""}
        </p>
        {money ? <p className="e-numeral text-[0.875rem]">{money}</p> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <EBadge tone={statusTone(status)} soft>{statusLabel(status)}</EBadge>
        <FlagPills job={job} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-2.5">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          <UserRound className="h-3 w-3 shrink-0 text-[hsl(var(--e-text-faint))]" />
          {cleaners.length > 0 ? cleaners.join(", ") : <span className="text-[hsl(var(--e-text-faint))]">Unassigned</span>}
        </p>
        <span className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
          {onManage ? (
            <EButton size="sm" variant="ghost" aria-label={`Manage ${job?.property?.name ?? "job"}`} onClick={() => onManage(job)}>
              <Settings2 className="h-3.5 w-3.5" />
            </EButton>
          ) : null}
          {status === "UNASSIGNED" && String(job?.cleanSkipStatus ?? "") !== "SKIPPED" ? (
            <EButton size="sm" variant="outline-gold" onClick={() => onQuickAssign(job)}>
              Assign
            </EButton>
          ) : null}
        </span>
      </div>
    </div>
  );
}
