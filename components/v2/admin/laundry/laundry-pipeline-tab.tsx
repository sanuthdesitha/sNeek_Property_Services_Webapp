"use client";

/**
 * Pipeline tab: the lanes for the chosen day (or the Completed history view),
 * the run side panel and the run dialogs — Edit (existing dialog), Reschedule
 * and "Move to <next day>" (reschedule endpoint), Skip or delete (existing
 * soft/permanent dialog with its confirmation) and Task report / PDF.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { toast } from "@/hooks/use-toast";
import { useLaundryDeleteDialog, type LaundryDeletePayload } from "@/components/v2/laundry/laundry-delete-dialog";
import { usePeekParam } from "@/components/v2/admin/jobs/use-peek-param";
import { addDaysToKey } from "@/lib/time/sydney-range";
import { PIPELINE_LANES, type PipelineView } from "@/lib/laundry/pipeline";
import { LaundryPipelineBoard } from "./laundry-pipeline-board";
import { LaundryHistory, type HistoryFilters } from "./laundry-history";
import { LaundryRunPanel, type RunPanelTask } from "./laundry-run-panel";
import { LaundryEditDialog } from "./laundry-edit-dialog";
import { LaundryMoveDialog, requestMove, summarizeMove, type MoveReport, type MoveTarget } from "./laundry-move";
import { shortDay } from "./laundry-lane-card";
import { useOpenRun } from "./use-open-run";
import type { LaundryTaskDTO } from "./laundry-shared";
import type { LaundryFeed } from "./use-laundry-feed";
import type { PipelineCardDTO, PipelineQuery, PipelineState } from "./use-laundry-pipeline";

type Props = {
  pipeline: PipelineState;
  query: PipelineQuery;
  onQuery: (patch: Partial<PipelineQuery>) => void;
  exceptionsFirst: boolean;
  onExceptionsFirst: (value: boolean) => void;
  view: PipelineView;
  onView: (view: PipelineView) => void;
  feed: LaundryFeed;
  history: HistoryFilters;
  onHistory: (patch: Partial<HistoryFilters>) => void;
  savingIds: ReadonlySet<string>;
  setSaving: (id: string, saving: boolean) => void;
  onEditing: (editing: boolean) => void;
  onReport: (task: LaundryTaskDTO) => void;
};

function moveTarget(task: LaundryTaskDTO): MoveTarget | null {
  return task.updatedAt ? { id: task.id, name: task.property?.name ?? "Run", updatedAt: task.updatedAt } : null;
}

export function LaundryPipelineTab(props: Props) {
  const { pipeline, query, view, feed, savingIds, setSaving } = props;
  const [openId, setOpenId] = usePeekParam();
  const [editTask, setEditTask] = React.useState<LaundryTaskDTO | null>(null);
  const [moveTargets, setMoveTargets] = React.useState<MoveTarget[] | null>(null);
  const [report, setReport] = React.useState<MoveReport | null>(null);
  const [panelNonce, setPanelNonce] = React.useState(0);

  const cards: PipelineCardDTO[] = pipeline.data ? PIPELINE_LANES.flatMap((lane) => pipeline.data?.lanes[lane] ?? []) : [];
  const onScreen: RunPanelTask[] = view === "completed" ? [...feed.tasks, ...cards] : [...cards, ...feed.tasks];
  const open = useOpenRun(openId, onScreen, panelNonce);
  const nextDay = addDaysToKey(query.date, 1);
  const nextDayLabel = pipeline.data && query.date === pipeline.data.today ? "Move to tomorrow" : `Move to ${shortDay(`${nextDay}T00:00:00.000Z`).split(" ")[0]}`;

  const { onEditing } = props;
  React.useEffect(() => onEditing(Boolean(editTask)), [editTask, onEditing]);

  const refreshAll = React.useCallback(() => {
    pipeline.reload();
    if (feed.status !== "idle") feed.reload();
    setPanelNonce((n) => n + 1);
  }, [pipeline, feed]);

  function finishMove(result: MoveReport) {
    setReport(result);
    setMoveTargets(null);
    refreshAll();
  }

  async function moveOne(card: PipelineCardDTO) {
    const target = moveTarget(card);
    if (!target) return;
    setSaving(card.id, true);
    try {
      finishMove(summarizeMove([target], await requestMove([target], nextDay)));
    } catch (cause) {
      toast({ title: "Not moved", description: cause instanceof Error ? cause.message : "Could not move the run.", variant: "destructive" });
    } finally {
      setSaving(card.id, false);
    }
  }

  const removeTask = React.useCallback(async (task: { id: string }, payload: LaundryDeletePayload) => {
    setSaving(task.id, true);
    try {
      const response = await fetch(`/api/laundry/${task.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => ({}))) as { error?: string; mayBeRecreated?: boolean };
      if (!response.ok) {
        toast({ title: "Could not delete", description: body.error ?? "The laundry set could not be removed.", variant: "destructive" });
        return false;
      }
      toast({
        title: payload.mode === "PERMANENT" ? "Laundry set deleted" : "Removed from the boards",
        description: body.mayBeRecreated ? "The plan generator may recreate this set from its job." : undefined,
      });
      if (payload.mode === "PERMANENT") setOpenId(null);
      refreshAll();
      return true;
    } catch (cause) {
      toast({ title: "Delete failed", description: cause instanceof Error ? cause.message : "Unknown error", variant: "destructive" });
      return false;
    } finally {
      setSaving(task.id, false);
    }
  }, [refreshAll, setOpenId, setSaving]);
  const { requestDelete, modal: deleteModal } = useLaundryDeleteDialog(removeTask);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pipeline view">
        <button type="button" aria-pressed={view === "board"} onClick={() => props.onView("board")} className={cn(E_CHIP_CLASS, view === "board" && E_CHIP_ON_CLASS)}>Lanes for the day</button>
        <button type="button" aria-pressed={view === "completed"} onClick={() => props.onView("completed")} className={cn(E_CHIP_CLASS, view === "completed" && E_CHIP_ON_CLASS)}>Completed history</button>
      </div>
      {report ? (
        <div role="status" className="text-[0.8125rem]">
          <p>{report.moved} moved{report.refused.length ? `, ${report.refused.length} not moved:` : "."}</p>
          {report.refused.length ? <ul className="list-disc pl-5 text-[hsl(var(--e-danger))]">{report.refused.map((row, index) => <li key={index}>{row.name}: {row.reason}</li>)}</ul> : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
        {view === "board" ? (
          <LaundryPipelineBoard
            data={pipeline.data}
            status={pipeline.status}
            error={pipeline.error}
            refreshFailed={pipeline.refreshFailed}
            query={query}
            onQuery={props.onQuery}
            exceptionsFirst={props.exceptionsFirst}
            onExceptionsFirst={props.onExceptionsFirst}
            openId={openId}
            savingIds={savingIds}
            nextDayLabel={nextDayLabel}
            onOpen={(card) => setOpenId(card.id)}
            onMove={(selected) => setMoveTargets(selected.map(moveTarget).filter((t): t is MoveTarget => Boolean(t)))}
            onMoveNextDay={(card) => void moveOne(card)}
            onRetry={pipeline.reload}
          />
        ) : (
          <LaundryHistory feed={feed} filters={props.history} onFilters={props.onHistory} openId={openId} onOpen={(task) => setOpenId(task.id)} />
        )}
        {openId && !open.task ? (
          <p role={open.status === "error" ? "alert" : "status"} className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] lg:w-[320px]">
            {open.status === "error" ? "That run could not be found." : "Loading run…"}{" "}
            <button type="button" className="underline" onClick={() => setOpenId(null)}>Close</button>
          </p>
        ) : null}
        <LaundryRunPanel
          task={open.task}
          busy={Boolean(open.task && savingIds.has(open.task.id))}
          onClose={() => setOpenId(null)}
          onEdit={setEditTask}
          onReschedule={(task) => {
            const target = moveTarget(task);
            if (target) setMoveTargets([target]);
          }}
          onDelete={requestDelete}
          onReport={props.onReport}
          onSaved={refreshAll}
          todayKey={pipeline.data?.today}
        />
      </div>
      <LaundryMoveDialog targets={moveTargets} defaultDate={nextDay} onClose={() => setMoveTargets(null)} onMoved={finishMove} />
      <LaundryEditDialog task={editTask} onClose={() => setEditTask(null)} onSaved={refreshAll} />
      {deleteModal}
    </div>
  );
}
