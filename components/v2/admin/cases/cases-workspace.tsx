"use client";

/**
 * ESTATE — Admin Cases inbox. Four columns at desktop, as designed: Queues,
 * Case list (summaries, server paged), Conversation and Details. On a phone the
 * queues become selectors, the list and the case are separate steps, and the
 * details open in a sheet.
 *
 * Phones (below 640px, board "Admin phone: Cases"): the queues are a swipeable
 * chip row (Type moves into Filters), "New case" docks at the bottom, and an
 * open case is a full screen with a switcher: Conversation / Details / Next
 * steps. The details form stays mounted while another part is shown, so its
 * draft survives switching; a different case resets the switcher.
 *
 * Endpoints (existing unless marked):
 *   GET    /api/admin/cases?shape=summary&queue&…   summaries + real counts (new shape; old shape unchanged)
 *   GET    /api/admin/cases/:id                     the full case
 *   GET    /api/admin/cases/:id/linked              facts derived from the linked job (new, read-only)
 *   PATCH  /api/admin/cases/:id                     { …patch, statusChangeNote }
 *   DELETE /api/admin/cases/:id                     { security }
 *   POST   /api/admin/cases/:id/comments            { body, isInternal }
 *   POST   /api/admin/cases/:id/attachments         after POST /api/uploads/direct
 *   POST   /api/admin/cases                         create (links validated on the server)
 *   POST   /api/admin/cases/bulk                    per-row outcomes (new)
 *   GET    /api/admin/quality/issues/case-options   "Raise QA issue for cleaner" options (new)
 *   POST   /api/admin/quality/issues                raise a QA issue from the case (new)
 */
import * as React from "react";
import { Plus, Search } from "lucide-react";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { usePeekParam } from "@/components/v2/admin/jobs/use-peek-param";
import { CaseQueueChips, CaseQueueSelectors, CaseQueuesRail } from "./case-queues";
import { CaseList } from "./case-list";
import { CaseConversation } from "./case-conversation";
import { CaseDetailsPanel } from "./case-details-panel";
import { CaseNewDialog } from "./case-new-dialog";
import { CaseStatusDialog, type StatusDialogRequest } from "./case-status-dialog";
import { CaseBulk } from "./case-bulk";
import { CaseRaiseQaDialog } from "./case-raise-qa-dialog";
import { defaultDraft, type ComposerDraft } from "./case-composer";
import { listQueryString, useCaseListState } from "./case-url-state";
import { useCaseList } from "./use-case-list";
import { useCaseDetail } from "./use-case-detail";
import { useCaseMutations } from "./use-case-mutations";
import { useIsDesktop } from "./use-is-desktop";
import type { CasePatch } from "./case-api";
import type { CaseStatus } from "./case-types";

type PhoneCasePart = "conversation" | "details" | "next";
const PHONE_CASE_PARTS: Array<{ key: PhoneCasePart; label: string }> = [
  { key: "conversation", label: "Conversation" },
  { key: "details", label: "Details" },
  { key: "next", label: "Next steps" },
];

type PendingStatus = { caseId: string; patch: CasePatch; request: StatusDialogRequest };

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function CasesWorkspace() {
  const [state, update] = useCaseListState();
  const debouncedQ = useDebounced(state.filters.q, 300);
  const query = listQueryString(state, debouncedQ);
  const list = useCaseList(query);
  const [openId, setOpenId] = usePeekParam();
  const detail = useCaseDetail(openId);
  const mutations = useCaseMutations({ rows: list.rows, accept: detail.accept, replaceRow: list.replaceRow, removeRow: list.removeRow, refreshCounts: list.refreshCounts });
  const isDesktop = useIsDesktop();
  const phone = useIsPhone();
  const [phonePart, setPhonePart] = React.useState<PhoneCasePart>("conversation");

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [drafts, setDrafts] = React.useState<Record<string, ComposerDraft>>({});
  const [pendingStatus, setPendingStatus] = React.useState<PendingStatus | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [detailsSheet, setDetailsSheet] = React.useState(false);
  const [raiseQaOpen, setRaiseQaOpen] = React.useState(false);
  const titleRef = React.useRef<HTMLInputElement>(null);

  // A different filter set starts a fresh selection.
  const filterKey = `${state.queue}|${debouncedQ}|${state.filters.caseType}|${state.filters.status}|${state.filters.assigneeUserId}|${state.filters.jobId}|${state.filters.reportId}`;
  React.useEffect(() => setSelected(new Set()), [filterKey]);
  // The client detail page links `?caseId=<id>`; treat it as `?open=`.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const legacy = params.get("caseId");
    if (legacy && !params.get("open")) setOpenId(legacy);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A new case closes the previous case's sheet and next-step dialog.
  React.useEffect(() => {
    setDetailsSheet(false);
    setRaiseQaOpen(false);
    setPhonePart("conversation");
  }, [openId]);

  /** Manual Refresh: re-read the list and counts (aborting an older read) and the open case. */
  function refreshAll() {
    list.reload();
    detail.refresh();
  }

  const open = detail.detail;
  const draft = open ? drafts[open.id] ?? defaultDraft(open) : null;
  const titles = React.useMemo(() => new Map(list.rows.map((row) => [row.id, row.title])), [list.rows]);

  function requestStatus(caseId: string, subject: string, patch: CasePatch, next: CaseStatus) {
    setPendingStatus({ caseId, patch, request: { subject, nextStatus: next } });
  }

  function saveFromDetails(patch: CasePatch) {
    if (!open) return;
    if (patch.status && patch.status !== open.status) {
      requestStatus(open.id, open.title, patch, patch.status);
      return;
    }
    void mutations.save(open.id, patch);
  }

  async function send() {
    if (!open || !draft?.body.trim()) return;
    const caseId = open.id;
    const ok = await mutations.send(caseId, draft);
    if (ok) setDrafts((current) => ({ ...current, [caseId]: { body: "", isInternal: draft.isInternal } }));
  }

  const conversation = open && draft ? (
    <CaseConversation
      detail={open}
      viewer={list.viewer}
      saving={mutations.savingId === open.id}
      draft={draft}
      onDraft={(next) => setDrafts((current) => ({ ...current, [open.id]: next }))}
      sending={mutations.sendingId === open.id}
      uploading={mutations.uploadingId === open.id}
      onSend={() => void send()}
      onAttach={(file) => void mutations.attach(open.id, file)}
      onStatus={(next) => requestStatus(open.id, open.title, { status: next }, next)}
      onAssignToMe={() => list.viewer && void mutations.save(open.id, { assignedToUserId: list.viewer.id })}
      onEditDetails={() => {
        if (phone) setPhonePart("details");
        else if (!isDesktop) setDetailsSheet(true);
        window.setTimeout(() => titleRef.current?.focus(), 0);
      }}
      onDelete={() => setDeleteOpen(true)}
      onBack={() => setOpenId(null)}
    />
  ) : null;

  const detailsPanel = open ? (
    <CaseDetailsPanel
      key={`${open.id}:${open.updatedAt}`}
      detail={open}
      linked={detail.linked}
      linkedStatus={detail.linkedStatus}
      assignees={list.assignees}
      viewer={list.viewer}
      saving={mutations.savingId === open.id}
      onSave={saveFromDetails}
      titleRef={titleRef}
      onRaiseQaIssue={() => setRaiseQaOpen(true)}
      visiblePart={phone && phonePart !== "conversation" ? phonePart : undefined}
    />
  ) : null;

  const caseStatusArea =
    openId && detail.status === "loading" ? (
      <p className="p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading case…</p>
    ) : openId && detail.status === "error" ? (
      <div role="alert" className="space-y-2 p-6 text-[0.875rem]">
        <p className="text-[hsl(var(--e-danger))]">{detail.error}</p>
        <div className="flex gap-2">
          <EButton size="sm" variant="outline" onClick={detail.reload}>Retry</EButton>
          <EButton size="sm" variant="ghost" onClick={() => setOpenId(null)}>Back to cases</EButton>
        </div>
      </div>
    ) : !openId ? (
      <p className="p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Choose a case from the list to read and answer it.</p>
    ) : null;

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Cases"
        description="Damage, disputes, complaints and client questions in one inbox"
        actions={
          <>
            <div className="relative w-full sm:w-[240px]">
              <label htmlFor="cases-search" className="sr-only">Search cases</label>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
              <input
                id="cases-search"
                type="search"
                value={state.filters.q}
                onChange={(event) => update({ filters: { ...state.filters, q: event.target.value } })}
                placeholder="Search cases, clients, job no."
                className="h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] pl-9 pr-3 text-[16px] sm:text-[0.8125rem]"
              />
            </div>
            <EButton onClick={() => setNewOpen(true)} className="max-sm:hidden">
              <Plus aria-hidden className="h-4 w-4" /> New case
            </EButton>
          </>
        }
      />

      {phone ? (
        openId ? null : <CaseQueueChips queue={state.queue} counts={list.counts} onQueue={(queue) => update({ queue })} />
      ) : (
      <CaseQueueSelectors
        queue={state.queue}
        caseType={state.filters.caseType}
        counts={list.counts}
        typeCounts={list.typeCounts}
        onQueue={(queue) => update({ queue })}
        onType={(caseType) => update({ filters: { ...state.filters, caseType } })}
      />
      )}

      <CaseBulk
        selectedIds={Array.from(selected)}
        titles={titles}
        assignees={list.assignees}
        viewer={list.viewer}
        onClear={() => setSelected(new Set())}
        onRowsUpdated={(rows) => rows.forEach(list.replaceRow)}
        onFinished={() => {
          setSelected(new Set());
          list.refreshCounts();
        }}
      />

      <div className="flex min-h-[calc(100dvh-14rem)] items-stretch gap-0">
        <CaseQueuesRail
          queue={state.queue}
          caseType={state.filters.caseType}
          counts={list.counts}
          typeCounts={list.typeCounts}
          onQueue={(queue) => update({ queue })}
          onType={(caseType) => update({ filters: { ...state.filters, caseType } })}
        />
        <CaseList
          className={openId ? "hidden flex-1 lg:flex lg:flex-none" : "flex-1 lg:flex-none"}
          rows={list.rows}
          status={list.status}
          error={list.error}
          refreshFailed={list.refreshFailed}
          total={list.total}
          page={state.page}
          sort={state.sort}
          dir={state.dir}
          filters={state.filters}
          assignees={list.assignees}
          viewer={list.viewer}
          openId={openId}
          selected={selected}
          onOpen={setOpenId}
          onToggle={(id) => setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
          onToggleAll={(ids, select) => setSelected(select ? new Set(ids) : new Set())}
          onSort={(sort, dir) => update({ sort, dir })}
          onFilters={(patch) => update({ filters: { ...state.filters, ...patch } })}
          onPage={(page) => update({ page })}
          onRetry={list.reload}
          onRefresh={refreshAll}
          typeFilter={phone ? { caseType: state.filters.caseType, typeCounts: list.typeCounts, onType: (caseType) => update({ filters: { ...state.filters, caseType } }) } : undefined}
        />
        <div className={openId ? "flex min-w-0 flex-1 flex-col" : "hidden min-w-0 flex-1 flex-col lg:flex"}>
          {phone && open ? (
            <div role="tablist" aria-label="Case sections" className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
              {PHONE_CASE_PARTS.map((part) => (
                <button
                  key={part.key}
                  type="button"
                  role="tab"
                  aria-selected={phonePart === part.key}
                  onClick={() => setPhonePart(part.key)}
                  className={cn(E_CHIP_CLASS, "shrink-0", phonePart === part.key && E_CHIP_ON_CLASS)}
                >
                  {part.label}
                </button>
              ))}
            </div>
          ) : null}
          {phone && open ? (
            <div className={phonePart === "conversation" ? "hidden" : "rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5"}>
              {detailsPanel}
            </div>
          ) : null}
          {phone && open && phonePart !== "conversation" ? null : conversation ?? (
            <section aria-label="Conversation" className="flex-1 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] lg:rounded-none lg:border-l-0">
              {caseStatusArea}
            </section>
          )}
          {open && !isDesktop && !phone ? (
            <EButton variant="outline" className="mt-3 self-start" onClick={() => setDetailsSheet(true)}>Case details</EButton>
          ) : null}
        </div>
        {open && isDesktop ? (
          <aside aria-label="Case details" className="hidden w-[290px] shrink-0 overflow-y-auto border border-l-0 border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5 lg:block">
            <p className="e-eyebrow mb-2">Details</p>
            {detailsPanel}
          </aside>
        ) : null}
      </div>

      {open && !isDesktop && !phone ? (
        <ESidePanel open={detailsSheet} title="Case details" label="Case details" subtitle={open.title} onClose={() => setDetailsSheet(false)}>
          {detailsPanel}
        </ESidePanel>
      ) : null}

      <EPhoneActionBar
        label="Cases actions"
        hidden={selected.size > 0 || Boolean(openId)}
        primary={<EButton onClick={() => setNewOpen(true)}><Plus aria-hidden className="h-4 w-4" /> New case</EButton>}
      />

      <CaseStatusDialog
        request={pendingStatus?.request ?? null}
        saving={Boolean(pendingStatus && mutations.savingId === pendingStatus.caseId)}
        onCancel={() => setPendingStatus(null)}
        onConfirm={async (note) => {
          if (!pendingStatus) return;
          const ok = await mutations.save(pendingStatus.caseId, pendingStatus.patch, note);
          if (ok) setPendingStatus(null);
        }}
      />
      {open ? <CaseRaiseQaDialog open={raiseQaOpen} detail={open} onClose={() => setRaiseQaOpen(false)} onRaised={detail.refresh} /> : null}
      <CaseNewDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(created) => {
          setNewOpen(false);
          setOpenId(created.id);
          list.reload();
        }}
      />
      <EConfirmModal
        open={deleteOpen && Boolean(open)}
        onClose={() => setDeleteOpen(false)}
        title="Delete case"
        description="This permanently removes the case, its comments, and attachments. This cannot be undone."
        confirmLabel="Delete case"
        confirmPhrase="DELETE"
        requireSecurity
        loading={mutations.deleting}
        onConfirm={async (credentials) => {
          if (!open) return;
          const ok = await mutations.remove(open.id, credentials);
          if (ok) {
            setDeleteOpen(false);
            setOpenId(null);
          }
        }}
      />
    </div>
  );
}
