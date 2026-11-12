"use client";

/**
 * ESTATE Calendar: heading and controls, the visible range only (week
 * resource grid, day time axis, month grid or agenda), the shared job peek
 * panel (`?open=<jobId>`), and moves through check → confirm → the existing
 * reschedule / assign endpoints.
 *
 * This file wires the pieces; each concern has its own file: URL state
 * (`use-calendar-state`), data (`use-calendar-data`), moves
 * (`use-calendar-move`), drag (`use-chip-drag`), toolbar, views, chip,
 * move dialog and confirmation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ECard } from "@/components/v2/ui/primitives";
import { JobPeekPanel } from "@/components/v2/admin/jobs/job-peek-panel";
import { ReassignNoteDialog } from "@/components/v2/admin/jobs/reassign-note-dialog";
import { useJobsReferenceData } from "@/components/v2/admin/jobs/use-jobs-reference-data";
import { usePeekParam } from "@/components/v2/admin/jobs/use-peek-param";
import { resolveDrop, type DropPoint } from "@/lib/calendar/drop";
import { parseHm, proposedDropStart } from "@/lib/calendar/time-drop";
import { buildLanes } from "@/lib/calendar/lanes";
import { rangeHeading, shiftCursor, viewRange, type CalendarView } from "@/lib/calendar/range";
import type { CalendarJob } from "@/lib/calendar/types";
import { calendarApiQuery } from "@/lib/calendar/url-state";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { CalendarAgenda } from "./calendar-agenda";
import { CalendarAssignDialogs } from "./calendar-assign-dialogs";
import { CalendarDayList } from "./calendar-day-list";
import { CalendarDayView } from "./calendar-day-view";
import type { ChipActions } from "./calendar-job-chip";
import { CalendarMonthGrid } from "./calendar-month-grid";
import { CalendarMoveConfirm } from "./calendar-move-confirm";
import { CalendarMoveDialog, type MoveDialogTarget } from "./calendar-move-dialog";
import { CalendarError, CalendarFootnote, CalendarLoading } from "./calendar-states";
import { CalendarToolbar } from "./calendar-toolbar";
import { CalendarWeekGrid, type GridDisplay } from "./calendar-week-grid";
import { useCalendarData } from "./use-calendar-data";
import { useCalendarMove } from "./use-calendar-move";
import { useCalendarState, useIsWide } from "./use-calendar-state";
import { useChipDrag } from "./use-chip-drag";

/** " to 10:15" while a chip is over a Day-view hour track, so the drop is predictable. */
function dragTimeLabel(drag: NonNullable<ReturnType<typeof useChipDrag>["drag"]>): string {
  if (drag.over?.minute == null) return "";
  const start = parseHm(drag.job.startTime);
  const grab = drag.source.minute != null && start !== null ? drag.source.minute - start : 0;
  const proposed = proposedDropStart({ pointerMinute: drag.over.minute, grabOffsetMinutes: grab });
  return proposed && proposed !== drag.job.startTime ? ` to ${proposed}` : "";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function CalendarWorkspace({ readOnly = false }: { readOnly?: boolean }) {
  const { state, ready, update } = useCalendarState();
  const wide = useIsWide();
  const today = useMemo(() => sydneyTodayKey(), []);
  const view: CalendarView = state.view ?? (wide ? "week" : "day");
  const cursor = state.date ?? today;
  const range = viewRange(view, cursor);
  const query = ready ? calendarApiQuery(range, state) : null;

  const reloadRef = useRef<() => void>(() => undefined);
  const move = useCalendarMove(useCallback(() => reloadRef.current(), []));
  const calendar = useCalendarData(query, move.pendingIds);
  reloadRef.current = calendar.reload;
  const reference = useJobsReferenceData();
  const [openJobId, setOpenJobId] = usePeekParam();
  const [assignJob, setAssignJob] = useState<CalendarJob | null>(null);
  const [qaJob, setQaJob] = useState<CalendarJob | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveDialogTarget | null>(null);
  const [notice, setNotice] = useState("");

  const data = calendar.status === "success" ? calendar.data : null;
  const lanes = useMemo(() => (data ? buildLanes(data, state.rows) : []), [data, state.rows]);
  const canDrag = wide && !readOnly && view !== "agenda";

  const onDrop = useCallback((job: CalendarJob, source: DropPoint, target: DropPoint) => {
    // Day view: the hour under the pointer proposes a new start (snapped),
    // less where on the chip it was grabbed. The server check decides.
    const start = parseHm(job.startTime);
    const grabOffsetMinutes = source.minute != null && start !== null ? source.minute - start : 0;
    const proposedStart = proposedDropStart({ pointerMinute: target.minute ?? null, grabOffsetMinutes });
    const outcome = resolveDrop(source, target, { currentStart: job.startTime, proposedStart });
    if (outcome.kind === "ignored") setNotice(outcome.reason);
    if (outcome.kind !== "move") return;
    setNotice("");
    void move.request({
      job, toDate: outcome.toDate, fromCleanerId: outcome.fromCleanerId, toCleanerId: outcome.toCleanerId,
      ...(outcome.toStartTime ? { toStartTime: outcome.toStartTime } : {}),
    });
  }, [move]);
  const drag = useChipDrag(onDrop);

  const actions: ChipActions = {
    readOnly,
    canDrag,
    onOpen: (job) => setOpenJobId(job.id),
    onMove: (job, source) => setMoveTarget({ job, sourceCleanerId: source.lane === "cleaner" ? source.rowId : null }),
    onAssign: setAssignJob,
    onQa: setQaJob,
    onPointerDown: canDrag ? drag.onChipPointerDown : () => undefined,
    consumeClickSuppression: drag.consumeClickSuppression,
  };
  const display: GridDisplay = { showArrivals: state.arrivals, showLaundry: state.laundry, pendingIds: move.pendingIds, drag: drag.drag };

  // Bring today into view once, when the loaded range contains it.
  const scrolledToToday = useRef(false);
  useEffect(() => {
    if (scrolledToToday.current || !data || data.range.start > data.today || data.range.end < data.today) return;
    const cell = document.querySelector<HTMLElement>("[data-calendar-today]");
    if (cell && typeof cell.scrollIntoView === "function") cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    scrolledToToday.current = true;
  }, [data]);

  const heading = rangeHeading(view, cursor);
  const summary = calendar.status === "error" ? `${heading} · could not be loaded`
    : !data ? `${heading} · loading…`
    : [heading, plural(data.summary.jobs, "job"), `${data.summary.withoutCleaner} without a cleaner`].join(" · ");
  const statusLine = [
    calendar.stale ? `Live refresh failed (${calendar.error}). Showing the calendar as last loaded; retrying automatically.` : null,
    data?.truncated ? "This range holds more jobs than one view can show; narrow it with a filter or a shorter view." : null,
    move.state.phase === "done" ? move.state.message : null,
    notice || null,
  ].filter(Boolean).join(" ") || null;

  const cleanerRows = data?.cleanerRows ?? [];
  const busyMoving = move.state.phase === "checking";

  function renderBody() {
    if (calendar.status === "error") return <CalendarError message={calendar.error} onRetry={calendar.reload} />;
    if (!data) return <CalendarLoading />;
    const empty = data.jobs.length === 0 ? <p className="border-b border-[hsl(var(--e-border))] px-4 py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No jobs in this range match the current filters.</p> : null;
    if (view === "agenda") return <CalendarAgenda data={data} actions={actions} display={display} emptyText="No jobs in this fortnight match the current filters." />;
    if (view === "month") return <>{empty}<CalendarMonthGrid data={data} cursor={cursor} actions={actions} display={display} onOpenDay={(day) => update({ view: "day", date: day })} /></>;
    if (!wide) return <>{empty}<CalendarDayList data={data} lanes={lanes} actions={actions} display={display} /></>;
    if (view === "day") return <>{empty}<CalendarDayView data={data} lanes={lanes} actions={actions} display={display} /></>;
    return <>{empty}<CalendarWeekGrid data={data} lanes={lanes} actions={actions} display={display} /></>;
  }

  return (
    <div className="lg:flex lg:items-start lg:gap-5">
      <div className="min-w-0 flex-1 space-y-[14px]">
        <CalendarToolbar
          view={view}
          state={state}
          summary={summary}
          statusLine={statusLine}
          clients={reference.clients}
          clientsState={reference.state.clients}
          statusCounts={data?.summary.statusCounts ?? null}
          unassignedTotal={data?.summary.unassignedTotal ?? null}
          loading={calendar.status === "loading"}
          dragHint={canDrag}
          onStep={(direction) => update({ date: shiftCursor(view, cursor, direction) })}
          onToday={() => update({ date: null })}
          onView={(next) => update({ view: next })}
          update={update}
          onRefresh={calendar.reload}
        />
        <ECard className="overflow-hidden">{renderBody()}</ECard>
        {data && view !== "agenda" && view !== "month" ? <CalendarFootnote hoursBasis={data.hoursBasis} /> : null}
      </div>

      <JobPeekPanel jobId={openJobId} row={null} readOnly={readOnly} onClose={() => setOpenJobId(null)} onChanged={calendar.reload} />

      {drag.drag ? (
        <div aria-hidden className="pointer-events-none fixed z-[70] rounded-[6px] border border-[hsl(var(--e-primary))] bg-[hsl(var(--e-surface))] px-2 py-1 text-[0.75rem] shadow-[var(--e-elevation-3)]"
          // A finger covers the chip: lift the label above the touch point.
          style={drag.drag.touch ? { left: drag.drag.x - 40, top: drag.drag.y - 56 } : { left: drag.drag.x + 12, top: drag.drag.y + 12 }}>
          Moving {drag.drag.job.propertyName}{dragTimeLabel(drag.drag)}
        </div>
      ) : null}

      {moveTarget ? (
        <CalendarMoveDialog
          key={moveTarget.job.id}
          target={moveTarget}
          cleaners={cleanerRows}
          busy={busyMoving}
          onClose={() => setMoveTarget(null)}
          onSubmit={(result) => {
            const job = moveTarget.job;
            setMoveTarget(null);
            void move.request({ job, ...result });
          }}
        />
      ) : null}
      <CalendarMoveConfirm state={move.state} onConfirm={() => void move.confirm()} onClose={move.dismiss} />
      {move.reassignPreview ? <ReassignNoteDialog preview={move.reassignPreview} onClose={move.clearReassignPreview} /> : null}
      <CalendarAssignDialogs
        assignJob={assignJob}
        qaJob={qaJob}
        cleaners={reference.cleaners}
        inspectors={reference.inspectors}
        inspectorsState={reference.state.inspectors}
        onCloseAssign={() => setAssignJob(null)}
        onCloseQa={() => setQaJob(null)}
        onChanged={calendar.reload}
      />
    </div>
  );
}
