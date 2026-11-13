"use client";

/**
 * One job on the calendar: "<b>10:00</b> Bondi Studio", a guest-arrival line
 * when shown, and its status in words and shape as well as colour (done ✓,
 * on site, late, offered, planned, no cleaner dashed, skipped). The name
 * opens the shared job peek panel; the menu holds Move or reassign…, Assign
 * cleaners…, Assign QA inspector… and Open full job. Mouse and pen drag a
 * movable chip; touch drags it after press-and-hold (a grip marks a draggable
 * chip). A chip that cannot move says why on hover and focus.
 */
import { Check, Clock, GripVertical, Loader2, MapPin, Send } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { DropPoint } from "@/lib/calendar/drop";
import { CHIP_CATEGORY_LABEL, CHIP_CATEGORY_TEXT, chipCategory, type ChipCategory } from "@/lib/calendar/presentation";
import type { CalendarJob } from "@/lib/calendar/types";

export type ChipActions = {
  readOnly: boolean;
  /** Dragging is offered on this view (wide layouts, not Agenda). */
  canDrag: boolean;
  onOpen: (job: CalendarJob) => void;
  onMove: (job: CalendarJob, source: DropPoint) => void;
  onAssign: (job: CalendarJob) => void;
  onQa: (job: CalendarJob) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, job: CalendarJob, source: DropPoint) => void;
  consumeClickSuppression: (jobId: string) => boolean;
};

const CATEGORY_CLASS: Record<ChipCategory, string> = {
  planned: "border-[hsl(var(--e-info)/0.3)] bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]",
  offered: "border-[hsl(var(--e-info)/0.3)] bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]",
  done: "border-[hsl(var(--e-success)/0.3)] bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]",
  late: "border-[hsl(var(--e-warning)/0.35)] bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]",
  onSite: "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]",
  unassigned: "border-[1.5px] border-dashed border-[hsl(var(--e-danger))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-danger))]",
  skipped: "border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] text-[hsl(var(--e-muted-foreground))]",
  cancelled: "border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] text-[hsl(var(--e-muted-foreground))] line-through",
};

function CategoryIcon({ category }: { category: ChipCategory }) {
  const className = "h-3 w-3 shrink-0";
  if (category === "done") return <Check aria-hidden className={className} />;
  if (category === "onSite") return <MapPin aria-hidden className={className} />;
  if (category === "late") return <Clock aria-hidden className={className} />;
  if (category === "offered") return <Send aria-hidden className={className} />;
  return null;
}

export function cleanerSummary(job: CalendarJob): string {
  if (job.cleaners.length === 0) return "No cleaner";
  const [first, ...rest] = job.cleaners;
  return rest.length > 0 ? `${first.name} +${rest.length}` : first.name;
}

export function chipDescription(job: CalendarJob): string {
  const parts = [
    job.startTime ?? "No start time",
    job.propertyName,
    job.jobType.replace(/_/g, " ").toLowerCase(),
    CHIP_CATEGORY_LABEL[chipCategory(job)],
    cleanerSummary(job),
  ];
  if (job.propertyMissingName) parts.push("no linked property name");
  return parts.join(" · ");
}

/**
 * The job's menu, shared by the chip and the phone agenda card: Open preview,
 * Open full job, Move or reassign…, Assign cleaners…, Assign QA inspector….
 */
export function chipMenuItems(job: CalendarJob, source: DropPoint, actions: ChipActions, pending: boolean): ERowMenuItem[] {
  const movable = !job.moveBlock && !actions.readOnly && !pending;
  return [
    { key: "open", label: "Open preview", onSelect: () => actions.onOpen(job) },
    { key: "full", label: "Open full job", href: `/v2/admin/jobs/${job.id}` },
    {
      key: "move", label: "Move or reassign…", separated: true, onSelect: () => actions.onMove(job, source),
      disabled: !movable, hint: pending ? "Saving…" : job.moveBlock ?? (actions.readOnly ? "Read-only view" : undefined),
    },
    { key: "assign", label: job.cleaners.length === 0 ? "Assign cleaners…" : "Reassign cleaners…", onSelect: () => actions.onAssign(job), disabled: actions.readOnly || pending, hint: actions.readOnly ? "Read-only view" : undefined },
    { key: "qa", label: job.qa?.assignedToId ? "Reassign QA inspector…" : "Assign QA inspector…", onSelect: () => actions.onQa(job), disabled: actions.readOnly, hint: actions.readOnly ? "Read-only view" : undefined },
  ];
}

type ChipProps = {
  job: CalendarJob;
  source: DropPoint;
  actions: ChipActions;
  showArrival: boolean;
  /** Month and property rows: name the cleaner on the chip. */
  showCleaner?: boolean;
  pending: boolean;
  dragging?: boolean;
};

export function CalendarJobChip({ job, source, actions, showArrival, showCleaner = false, pending, dragging = false }: ChipProps) {
  const category = chipCategory(job);
  const suffix = CHIP_CATEGORY_TEXT[category];
  const movable = !job.moveBlock && !actions.readOnly && !pending;
  const draggable = movable && actions.canDrag;
  const dragHint = draggable ? "Drag to another day or cleaner (on touch, press and hold first), or use the menu." : "Use the menu to move or reassign.";
  const hint = pending ? "A move for this job is being checked or saved." : job.moveBlock ?? (actions.readOnly ? "Read-only view: jobs cannot be moved." : dragHint);
  const menu = chipMenuItems(job, source, actions, pending);

  return (
    <div
      data-job-chip={job.id}
      data-pending={pending || undefined}
      className={cn(
        "group flex min-w-0 items-start gap-0.5 rounded-[6px] border text-[0.71875rem] leading-snug",
        CATEGORY_CLASS[category],
        pending && "opacity-70",
        dragging && "opacity-40",
        draggable && "cursor-grab select-none [-webkit-touch-callout:none]",
      )}
      onPointerDown={draggable ? (event) => actions.onPointerDown(event, job, source) : undefined}
    >
      {draggable ? <GripVertical aria-hidden className="mt-1 h-3 w-3 shrink-0 opacity-60" /> : null}
      <button
        type="button"
        title={`${chipDescription(job)}\n${hint}`}
        aria-label={`${chipDescription(job)}. ${hint}`}
        onClick={() => {
          if (actions.consumeClickSuppression(job.id)) return;
          actions.onOpen(job);
        }}
        className="min-w-0 flex-1 px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        <span className="flex min-w-0 items-center gap-1">
          {pending ? <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin" /> : <CategoryIcon category={category} />}
          <b className="e-tnum shrink-0 font-[650]">{job.startTime ?? "—"}</b>
          <span className={cn("min-w-0 truncate", category === "skipped" && "line-through")}>{job.propertyName}</span>
          {suffix ? <span className="shrink-0">· {suffix}</span> : null}
        </span>
        {showCleaner && job.cleaners.length > 0 ? <span className="block truncate opacity-80">{cleanerSummary(job)}</span> : null}
        {showArrival && job.guestArrival ? (
          <span className="block truncate">Guest in {job.guestArrival.time ?? "(time not set)"}</span>
        ) : null}
        {pending ? <span className="block">Move pending…</span> : null}
      </button>
      <ERowMenu label={`Actions for ${job.propertyName}`} items={menu} className="h-6 w-6 shrink-0 text-current" />
    </div>
  );
}
