"use client";

/**
 * ESTATE Jobs page: heading with the real match count, view tabs with live
 * totals, visible filter chips, the list (table grouped by Sydney day) or the
 * board, the bulk bar, and the peek panel (`?open=<jobId>`).
 *
 * This file wires the pieces together; each concern has its own file:
 * list data (`use-jobs-list`), filters (`jobs-filter-bar`), view tabs
 * (`jobs-view-tabs`), view options (`jobs-view-options`), table
 * (`jobs-table`), board (`jobs-board`), bulk (`jobs-bulk`), peek
 * (`job-peek-panel`). State lives in the URL (`use-jobs-workspace-state`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { ECard, EButton } from "@/components/v2/ui/primitives";
import { EPagination } from "@/components/v2/ui/pagination";
import { pickJobsFilters } from "@/lib/jobs/view-presets";
import { jobsScrollContentFingerprint } from "@/lib/jobs/scroll-restoration";
import { BulkRemindDialog } from "./bulk-remind-dialog";
import { JobPeekPanel } from "./job-peek-panel";
import { jobRowMenuItems } from "./job-row-menu";
import { JobStatusDialog, type StatusChangeRequest } from "./job-status-dialog";
import type { JobsDensityValue } from "./job-row";
import { JobsBoard } from "./jobs-board";
import { JobsBulk } from "./jobs-bulk";
import { JobsFilterBar } from "./jobs-filter-bar";
import { JobsHeader } from "./jobs-header";
import { JOBS_PAGE_SIZE, buildJobsQuery, stateSortFromTable, tableSortFromState, type JobListRow } from "./jobs-query";
import { JobsTable } from "./jobs-table";
import { JobsViewOptions } from "./jobs-view-options";
import { JobsViewTabs } from "./jobs-view-tabs";
import { QuickAssignDialog } from "./quick-assign-dialog";
import { useJobsBoard, type JobsBoardLane } from "./use-jobs-board";
import { useJobsList } from "./use-jobs-list";
import { useJobsReferenceData } from "./use-jobs-reference-data";
import { useJobsSavedViews } from "./use-jobs-saved-views";
import { useSavedViewCounts } from "./use-saved-view-counts";
import { useJobsScrollRestoration } from "./use-jobs-scroll-restoration";
import { useJobsWorkspaceState } from "./use-jobs-workspace-state";
import { usePeekParam } from "./use-peek-param";
import { CancelJobDialog } from "./cancel-job-dialog";

type WorkspaceProps = {
  /** Renders the page's h1. Embedded uses pass false and keep their own heading. */
  showPageHeader?: boolean;
  viewsContext?: string;
  viewsReadOnly?: boolean;
  teamDefaultsEnabled?: boolean;
};

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function JobsWorkspace({ viewsContext, viewsReadOnly = false, teamDefaultsEnabled = false, showPageHeader = false }: WorkspaceProps) {
  const { state, ready, update, applyDefault, columnsError } = useJobsWorkspaceState();
  const reference = useJobsReferenceData();
  const savedViews = useJobsSavedViews(viewsContext ?? null);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [createRequest, setCreateRequest] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [openJobId, setOpenJobId] = usePeekParam();
  const now = useNow(15_000);

  // Queries: the list page (with view-tab totals and the derived columns), the
  // export (same filters and sort, first 5,000) and the board (same filters).
  const listQuery = buildJobsQuery(state, { page: String(state.page), limit: String(JOBS_PAGE_SIZE), counts: "1", extras: "1" }).toString();
  const exportQuery = buildJobsQuery(state, { page: "1", limit: "5000" }).toString();
  const boardParams = buildJobsQuery(state);
  boardParams.delete("paginated");
  const boardQuery = boardParams.toString();

  const list = useJobsList(listQuery, ready);
  const savedCounts = useSavedViewCounts(viewsContext ? savedViews.data?.views ?? null : null, list.loadedAt);
  const board = useJobsBoard(boardQuery, ready && state.view === "board");
  const loading = list.status === "loading";

  const scrollContent = useMemo(() => jobsScrollContentFingerprint(JSON.stringify([list.jobs, list.pagination.totalCount])), [list.jobs, list.pagination.totalCount]);
  useJobsScrollRestoration({ context: viewsContext, viewKey: JSON.stringify([state, listQuery]), contentKey: scrollContent, ready: list.status === "success" });

  // Selection: cleared when the filters change, trimmed to the rows on screen.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filterSignature = JSON.stringify(pickJobsFilters(state));
  useEffect(() => setSelected(new Set()), [filterSignature]);
  const visibleJobs: JobListRow[] = useMemo(
    () => (state.view === "board" ? board.board?.lanes.flatMap((lane) => lane.jobs) ?? [] : list.jobs),
    [state.view, board.board, list.jobs],
  );
  useEffect(() => {
    if (state.view === "list" ? list.status !== "success" : board.status !== "success") return;
    const allowed = new Set(visibleJobs.map((job) => job.id));
    setSelected((current) => {
      const next = new Set(Array.from(current).filter((id) => allowed.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleJobs, state.view, list.status, board.status]);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const [assignJob, setAssignJob] = useState<JobListRow | null>(null);
  const [statusRequest, setStatusRequest] = useState<StatusChangeRequest | null>(null);
  const [remindIds, setRemindIds] = useState<string[] | null>(null);
  const [cancelRequest, setCancelRequest] = useState<{ jobIds: string[]; label?: string } | null>(null);

  const refreshAll = useCallback(() => {
    list.reload();
    if (state.view === "board") board.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reload, board.reload, state.view]);

  const openPeek = useCallback((job: JobListRow) => setOpenJobId(job.id), [setOpenJobId]);
  const menuItems = useCallback(
    (job: JobListRow) => jobRowMenuItems(job, {
      onPreview: openPeek,
      onChangeStatus: (row) => setStatusRequest({ jobIds: [row.id], title: `Change status · ${row.property?.name ?? "job"}` }),
      onRemind: (row) => setRemindIds([row.id]),
      onCancel: (row) => setCancelRequest({ jobIds: [row.id], label: row.property?.name ?? undefined }),
    }, viewsReadOnly),
    [openPeek, viewsReadOnly],
  );

  function dropToLane(job: JobListRow, lane: JobsBoardLane) {
    setStatusRequest({
      jobIds: [job.id],
      statuses: lane.statuses,
      title: `Move ${job.property?.name ?? "job"} to ${lane.label}`,
    });
  }

  const openRow = openJobId ? visibleJobs.find((job) => job.id === openJobId) ?? list.jobs.find((job) => job.id === openJobId) ?? null : null;
  const canSaveView = Boolean(viewsContext) && !viewsReadOnly && Boolean(savedViews.data) && !savedViews.busy && !columnsError && (savedViews.data?.views.length ?? 0) < 20;

  return (
    <div className="lg:flex lg:items-start lg:gap-5">
      <div className="min-w-0 flex-1 space-y-[14px]">
        <JobsHeader
          showTitle={showPageHeader}
          status={list.status}
          totalCount={list.pagination.totalCount}
          loadedAt={list.loadedAt}
          now={now}
          refreshFailed={list.refreshFailed}
          exportQuery={exportQuery}
          exportDisabled={!ready}
          viewsContext={viewsContext}
          readOnly={viewsReadOnly}
          onImported={refreshAll}
        />
        <JobsViewTabs
          state={state}
          update={update}
          counts={list.counts}
          savedCounts={savedCounts}
          savedViews={viewsContext ? savedViews : null}
          selectedSavedId={selectedSavedId}
          onSelectSaved={setSelectedSavedId}
          onSaveView={() => { setCreateRequest((value) => value + 1); }}
          canSave={canSaveView}
        />
        <JobsFilterBar state={state} update={update} reference={reference} optionsOpen={optionsOpen} onToggleOptions={() => setOptionsOpen((open) => !open)} />
        <JobsViewOptions
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          state={state}
          update={update}
          applyDefault={applyDefault}
          columnsError={columnsError}
          viewsContext={viewsContext}
          viewsReadOnly={viewsReadOnly}
          teamDefaultsEnabled={teamDefaultsEnabled}
          savedViews={viewsContext ? savedViews : null}
          selectedSavedId={selectedSavedId}
          onSelectSaved={setSelectedSavedId}
          createRequest={createRequest}
        />

        {list.refreshFailed && state.view === "list" ? (
          <p role="status" className="text-[0.8125rem]">Live refresh unavailable. Showing the last loaded jobs; retrying automatically.</p>
        ) : null}

        {state.view === "board" ? (
          <JobsBoard
            data={board}
            density={state.density as JobsDensityValue}
            selected={selected}
            activeJobId={openJobId}
            readOnly={viewsReadOnly}
            onToggleSelect={(id) => setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            onOpen={openPeek}
            onQuickAssign={setAssignJob}
            menuItems={menuItems}
            onDropToLane={dropToLane}
          />
        ) : list.status === "error" ? (
          <ECard className="px-6 py-12 text-center">
            <p role="alert" className="mb-4 text-[0.875rem]">{list.error}</p>
            <EButton variant="outline" onClick={list.reload}>Retry</EButton>
          </ECard>
        ) : (
          <ECard className="overflow-hidden">
            <JobsTable
              jobs={loading ? [] : list.jobs}
              columns={state.columns}
              density={state.density as JobsDensityValue}
              sort={tableSortFromState(state.sort)}
              onSortChange={(sort) => update({ sort: stateSortFromTable(sort) })}
              selected={selected}
              onSelectionChange={setSelected}
              activeJobId={openJobId}
              onOpen={openPeek}
              onQuickAssign={setAssignJob}
              menuItems={menuItems}
              loading={loading}
              staleError={null}
              onRetry={list.reload}
            />
          </ECard>
        )}

        {state.view === "list" && list.status === "success" && list.pagination.totalPages > 1 ? (
          <EPagination page={list.pagination.page} pageSize={JOBS_PAGE_SIZE} total={list.pagination.totalCount} noun="jobs"
            onPageChange={(page) => update({ page })} disabled={loading} />
        ) : null}

        <JobsBulk
          selectedIds={selectedIds}
          cleaners={reference.cleaners}
          inspectors={reference.inspectors}
          exportQuery={buildJobsQuery(state, { page: "1", limit: "5000", ids: selectedIds.join(",") }).toString()}
          viewsContext={viewsContext}
          readOnly={viewsReadOnly}
          onClear={() => setSelected(new Set())}
          onChangeStatus={() => setStatusRequest({ jobIds: selectedIds })}
          onCancelJobs={() => setCancelRequest({ jobIds: selectedIds })}
          onDone={(keep) => { setSelected(new Set(keep)); refreshAll(); }}
        />
      </div>

      <JobPeekPanel jobId={openJobId} row={openRow} readOnly={viewsReadOnly} onClose={() => setOpenJobId(null)} onChanged={refreshAll} />

      <QuickAssignDialog job={assignJob} cleaners={reference.cleaners} onClose={() => setAssignJob(null)}
        onAssigned={() => { setAssignJob(null); refreshAll(); }} />
      <JobStatusDialog
        request={statusRequest}
        viewsContext={viewsContext}
        readOnly={viewsReadOnly}
        onClose={() => setStatusRequest(null)}
        onApplied={(count) => {
          toast({ title: "Status updated", description: `${count} job${count === 1 ? "" : "s"} moved to the reviewed status.` });
          setStatusRequest(null);
          setSelected(new Set());
          refreshAll();
        }}
      />
      <CancelJobDialog open={cancelRequest !== null} jobIds={cancelRequest?.jobIds ?? []} label={cancelRequest?.label}
        onClose={() => setCancelRequest(null)}
        onDone={(remaining) => { setSelected(new Set(remaining)); refreshAll(); }} />
      <BulkRemindDialog open={remindIds !== null} jobIds={remindIds ?? []} onClose={() => setRemindIds(null)} onFinished={() => refreshAll()} />
    </div>
  );
}

