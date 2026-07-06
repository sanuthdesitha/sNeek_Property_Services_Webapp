"use client";

/**
 * ESTATE jobs workspace — row + board card presentation.
 * Pure Estate language: hairline dividers, serif property names, e-numeral
 * money, EBadge status pills. Data comes straight from /api/jobs rows.
 */
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { UserRound, UserRoundPlus } from "lucide-react";
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
  return (
    <>
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
};

/** List row: property (serif) · client · cleaner · time · status · money. */
export function EJobRow({ job, selected, onToggleSelect, onQuickAssign }: RowProps) {
  const router = useRouter();
  const cleaners = assignmentNames(job);
  const clientName = job?.property?.client?.name ?? job?.client?.name ?? "—";
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
      className="group grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors duration-[160ms] hover:bg-[hsl(var(--e-muted)/0.6)] md:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_auto_auto_auto]"
    >
      <ECheck checked={selected} onChange={() => onToggleSelect(job.id)} label={`Select ${job?.property?.name ?? "job"}`} />

      {/* Property + secondary line */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="e-serif truncate text-[1rem] font-[520] leading-tight">
            {job?.property?.name ?? "Unknown property"}
          </p>
          {job?.jobNumber ? (
            <span className="e-tnum text-[0.6875rem] tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
              {job.jobNumber}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {[job?.property?.suburb, String(job?.jobType ?? "").replace(/_/g, " ").toLowerCase()]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
          <FlagPills job={job} />
        </div>
      </div>

      {/* Client */}
      <div className="hidden min-w-0 md:block">
        <p className="e-eyebrow text-[0.5625rem]">Client</p>
        <p className="truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{clientName}</p>
      </div>

      {/* Cleaner */}
      <div className="hidden min-w-0 md:block">
        <p className="e-eyebrow text-[0.5625rem]">Cleaner</p>
        <p className="flex items-center gap-1.5 truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <UserRound className="h-3 w-3 shrink-0 text-[hsl(var(--e-text-faint))]" />
          {cleaners.length > 0 ? cleaners.join(", ") : <span className="text-[hsl(var(--e-text-faint))]">Unassigned</span>}
        </p>
      </div>

      {/* Time */}
      <div className="hidden text-right md:block">
        <p className="e-tnum text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{scheduledLabel(job?.scheduledDate)}</p>
        <p className="e-tnum text-[0.75rem] text-[hsl(var(--e-text-faint))]">{job?.startTime ?? "—"}</p>
      </div>

      {/* Status + money */}
      <div className="col-start-3 row-start-1 flex items-center justify-end gap-3 md:col-start-auto md:row-start-auto">
        <EBadge tone={statusTone(status)} soft>{statusLabel(status)}</EBadge>
      </div>
      <div className="hidden w-[5.5rem] text-right md:block">
        {money ? (
          <p className="e-numeral text-[0.9375rem]">{money}</p>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">—</p>
        )}
      </div>

      {/* Row actions */}
      <div className="col-span-3 flex items-center justify-end gap-2 md:col-span-1" onClick={(event) => event.stopPropagation()}>
        {status === "UNASSIGNED" && String(job?.cleanSkipStatus ?? "") !== "SKIPPED" ? (
          <EButton size="sm" variant="outline-gold" onClick={() => onQuickAssign(job)}>
            <UserRoundPlus className="h-3.5 w-3.5" />
            Assign
          </EButton>
        ) : null}
        <EButton
          size="sm"
          variant="ghost"
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => router.push(`/v2/admin/jobs/${job.id}`)}
        >
          Open
        </EButton>
      </div>
    </div>
  );
}

/** Board card — compact ceremony of the same facts. */
export function EBoardCard({ job, selected, onToggleSelect, onQuickAssign }: RowProps) {
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
        {status === "UNASSIGNED" && String(job?.cleanSkipStatus ?? "") !== "SKIPPED" ? (
          <span onClick={(event) => event.stopPropagation()}>
            <EButton size="sm" variant="outline-gold" onClick={() => onQuickAssign(job)}>
              Assign
            </EButton>
          </span>
        ) : null}
      </div>
    </div>
  );
}
