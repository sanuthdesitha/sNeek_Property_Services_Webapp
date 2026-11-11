"use client";

/**
 * Jobs board: four lanes for the current filters, each with its real total.
 * Dragging a card to another lane opens the reviewed status change for that
 * job, limited to the lane's statuses; nothing changes until the review is
 * applied. Invoiced cards cannot be dragged (they are locked). Keyboard users
 * use "Change status…" in the card's menu, which opens the same review.
 */
import { useState, type DragEvent } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";
import { cn } from "@/lib/utils";
import { canDropIntoLane, type JobsBoardLaneId } from "@/lib/jobs/board-lanes";
import { EBoardCard, type JobsDensityValue } from "./job-row";
import type { JobListRow } from "./jobs-query";
import type { JobsBoardData, JobsBoardLane } from "./use-jobs-board";

const DRAG_TYPE = "application/x-sneek-job";

type BoardProps = {
  data: JobsBoardData;
  density: JobsDensityValue;
  selected: ReadonlySet<string>;
  activeJobId: string | null;
  readOnly: boolean;
  onToggleSelect: (jobId: string) => void;
  onOpen: (job: JobListRow) => void;
  onQuickAssign: (job: JobListRow) => void;
  menuItems: (job: JobListRow) => ERowMenuItem[];
  onDropToLane: (job: JobListRow, lane: JobsBoardLane) => void;
};

export function JobsBoard({ data, density, selected, activeJobId, readOnly, onToggleSelect, onOpen, onQuickAssign, menuItems, onDropToLane }: BoardProps) {
  const [dragging, setDragging] = useState<JobListRow | null>(null);
  const [overLane, setOverLane] = useState<JobsBoardLaneId | null>(null);

  if (data.status === "loading" || data.status === "idle") {
    return <p role="status" className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-6 py-12 text-center text-[0.875rem]">Loading the board…</p>;
  }
  if (data.status === "error" || !data.board) {
    return (
      <div role="alert" className="space-y-3 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-6 py-10 text-center text-[0.875rem]">
        <p>{data.error || "The board could not load."}</p>
        <EButton size="sm" variant="outline" onClick={data.reload}>Try again</EButton>
      </div>
    );
  }

  function startDrag(event: DragEvent<HTMLElement>, job: JobListRow) {
    event.dataTransfer.setData(DRAG_TYPE, job.id);
    event.dataTransfer.effectAllowed = "move";
    setDragging(job);
  }

  return (
    <div className="space-y-2">
      {data.refreshFailed ? <p role="status" className="text-[0.8125rem]">Live refresh unavailable. Showing the last loaded board; retrying automatically.</p> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.board.lanes.map((lane) => {
          const droppable = Boolean(dragging) && !readOnly && canDropIntoLane(dragging!.status, lane.id);
          return (
            <section
              key={lane.id}
              aria-label={`${lane.label}, ${lane.count} job${lane.count === 1 ? "" : "s"}`}
              onDragOver={(event) => {
                if (!droppable) return;
                event.preventDefault();
                setOverLane(lane.id);
              }}
              onDragLeave={() => setOverLane((current) => (current === lane.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const job = dragging;
                setDragging(null);
                setOverLane(null);
                if (job && droppable) onDropToLane(job, lane);
              }}
              className={cn("min-w-0 rounded-[12px] p-1", overLane === lane.id && "bg-[hsl(var(--e-primary-soft))] outline outline-2 outline-[hsl(var(--e-primary))]")}
            >
              <div className="mb-3 flex items-baseline justify-between border-b border-[hsl(var(--e-border))] pb-2">
                <h3 className="e-eyebrow">{lane.label}</h3>
                <span className="e-numeral text-[1rem]">{lane.count}</span>
              </div>
              <div className="space-y-2.5">
                {lane.jobs.map((job) => (
                  <EBoardCard
                    key={job.id}
                    job={job}
                    density={density}
                    selected={selected.has(job.id)}
                    active={activeJobId === job.id}
                    onToggleSelect={onToggleSelect}
                    onOpen={onOpen}
                    onQuickAssign={onQuickAssign}
                    menuItems={menuItems(job)}
                    draggable={!readOnly && job.status !== "INVOICED"}
                    onDragStart={startDrag}
                  />
                ))}
                {lane.count === 0 ? (
                  <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-4 py-8 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">Empty</div>
                ) : null}
                {lane.count > lane.jobs.length ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Showing {lane.jobs.length} of {lane.count}. Narrow the filters or use the list to see the rest.
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
