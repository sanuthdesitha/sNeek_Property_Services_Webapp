"use client";

/**
 * Agenda (kept from the previous calendar): the days of the loaded range that
 * have jobs, one row per job with time, property, type and suburb, cleaner,
 * status, Assign / Reassign, QA inspector, and the job's menu. The range is
 * stated in the header ("11 – 24 November": a fortnight from the cursor day),
 * so the text matches what is listed.
 */
import { ShieldCheck, User2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import type { DropPoint } from "@/lib/calendar/drop";
import { jobsOnDay } from "@/lib/calendar/lanes";
import { CHIP_CATEGORY_LABEL, chipCategory, type ChipCategory } from "@/lib/calendar/presentation";
import { longDayLabel } from "@/lib/calendar/range";
import type { CalendarJob, CalendarResponse } from "@/lib/calendar/types";
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { cleanerSummary, type ChipActions } from "./calendar-job-chip";
import type { GridDisplay } from "./calendar-week-grid";

const PILL_TONE: Record<ChipCategory, "neutral" | "ok" | "warn" | "bad" | "info" | "gold"> = {
  done: "ok", onSite: "info", late: "warn", offered: "info", planned: "info", unassigned: "bad", skipped: "neutral",
};

function AgendaRow({ job, actions, pending }: { job: CalendarJob; actions: ChipActions; pending: boolean }) {
  const category = chipCategory(job);
  const unassigned = job.cleaners.length === 0;
  const source: DropPoint = { lane: "unassigned", rowId: null, day: job.day };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5" data-pending={pending || undefined}>
      <button type="button" onClick={() => actions.onOpen(job)} className="flex min-w-0 flex-1 basis-full items-center gap-3 text-left sm:basis-0">
        <span className="e-tnum w-14 shrink-0 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{job.startTime || "—"}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[0.8125rem] font-[550]", job.propertyMissingName && "text-[hsl(var(--e-warning))]")}
            title={job.propertyMissingName ? "No linked property name" : undefined}>
            {job.propertyName}
          </span>
          <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {job.jobType.replace(/_/g, " ").toLowerCase()}{job.suburb ? ` · ${job.suburb}` : ""}
            {job.guestArrival ? ` · Guest in ${job.guestArrival.time ?? "(time not set)"}` : ""}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        <User2 aria-hidden className="h-3 w-3 text-[hsl(var(--e-text-faint))]" />
        {unassigned ? <span className="text-[hsl(var(--e-danger))]">No cleaner</span> : cleanerSummary(job)}
      </span>
      <EPill tone={PILL_TONE[category]}>{pending ? "Move pending" : `${STATUS_LABELS[job.status] ?? job.status}${category === "late" || category === "skipped" ? ` · ${CHIP_CATEGORY_LABEL[category].toLowerCase()}` : ""}`}</EPill>
      <EButton variant={unassigned ? "gold" : "outline"} size="sm" onClick={() => actions.onAssign(job)} disabled={actions.readOnly || pending}>
        <UserPlus aria-hidden className="mr-1 h-3 w-3" />
        {unassigned ? "Assign" : "Reassign"}
      </EButton>
      <EButton variant={job.qa?.assignedToId ? "outline" : "ghost"} size="sm" onClick={() => actions.onQa(job)} disabled={actions.readOnly}
        title={job.qa?.assignedToName ? `QA inspector: ${job.qa.assignedToName}` : "No QA inspector assigned"}>
        <ShieldCheck aria-hidden className="mr-1 h-3 w-3" />
        {job.qa?.assignedToId ? "QA set" : "QA"}
      </EButton>
      <ERowMenu
        label={`More actions for ${job.propertyName}`}
        items={[
          { key: "full", label: "Open full job", href: `/v2/admin/jobs/${job.id}` },
          { key: "move", label: "Move or reassign…", onSelect: () => actions.onMove(job, source),
            disabled: Boolean(job.moveBlock) || actions.readOnly || pending, hint: job.moveBlock ?? (actions.readOnly ? "Read-only view" : pending ? "Saving…" : undefined) },
        ]}
      />
    </div>
  );
}

export function CalendarAgenda({ data, actions, display, emptyText }: { data: CalendarResponse; actions: ChipActions; display: GridDisplay; emptyText: string }) {
  const days = data.range.days.map((day) => ({ day, jobs: jobsOnDay(data, day) })).filter((entry) => entry.jobs.length > 0);
  if (days.length === 0) return <p className="px-5 py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{emptyText}</p>;
  return (
    <div>
      {days.map(({ day, jobs }) => (
        <section key={day} aria-label={longDayLabel(day)} className="border-b border-[hsl(var(--e-border))] last:border-0">
          <h2 className="flex items-center justify-between bg-[hsl(var(--e-surface-raised))] px-5 py-2 text-[0.8125rem] font-[550]">
            <span>{longDayLabel(day)}{day === data.today ? <span className="ml-2 text-[hsl(var(--e-gold-ink))]">· Today</span> : null}</span>
            <span className="e-numeral text-[0.75rem] font-[400] text-[hsl(var(--e-muted-foreground))]">{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</span>
          </h2>
          {jobs.map((job) => <AgendaRow key={job.id} job={job} actions={actions} pending={display.pendingIds.has(job.id)} />)}
        </section>
      ))}
    </div>
  );
}
