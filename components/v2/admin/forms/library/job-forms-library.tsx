"use client";

/**
 * Job forms tab of the Forms library: the groups panel on the left (stacked
 * above at phone width) and, on the right, search and filters, the forms
 * table, the bulk bar and its panels, and paging.
 */
import * as React from "react";
import Link from "next/link";
import { EAlert, ECard } from "@/components/v2/ui/primitives";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { formColumns } from "./forms-columns";
import { FormsGroupsPanel } from "./forms-groups-panel";
import { FormsToolbar } from "./forms-toolbar";
import { FormsBulk } from "./forms-bulk";
import { FORMS_PAGE_SIZE, formsFilterSignature, useFormGroups, useFormsListData, useFormsListState } from "./use-forms-library";
import { useFormRowActions } from "./use-form-row-actions";

export function JobFormsLibrary({ canWrite }: { canWrite: boolean }) {
  const [state, update] = useFormsListState();
  const list = useFormsListData(state);
  const groups = useFormGroups();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const signature = formsFilterSignature(state);
  const { reload: reloadList } = list;
  const { reload: reloadGroups } = groups;

  // Selection spans pages of ONE filter set; a new filter starts empty.
  React.useEffect(() => setSelected(new Set()), [signature]);

  const refresh = React.useCallback(() => {
    reloadList();
    reloadGroups();
  }, [reloadList, reloadGroups]);
  const rowActions = useFormRowActions(refresh);
  const payload = list.payload;
  const columns = formColumns({
    timezone: payload?.timezone ?? "Australia/Sydney",
    statsWeeks: payload?.statsBasis.weeks ?? 8,
    canWrite,
    actions: rowActions.actions,
    busyId: rowActions.busyId,
  });
  const selectedIds = Array.from(selected);

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-stretch">
      <FormsGroupsPanel
        groups={groups.groups}
        groupsError={groups.error}
        counts={payload?.counts ?? null}
        scope={state.scope}
        group={state.group}
        tag={state.tag}
        canWrite={canWrite}
        onSelect={(patch) => update(patch)}
        onTag={(tag) => update({ tag })}
        onGroupsChanged={refresh}
      />
      <section aria-label="Forms in group" className="flex min-w-0 flex-1 flex-col gap-2.5">
        <FormsToolbar state={state} update={update} problemCount={payload?.counts.problems ?? null} />
        {rowActions.notice ? (
          <EAlert tone={rowActions.notice.tone} title={rowActions.notice.tone === "success" ? "Done" : "Not done"}>
            <span>{rowActions.notice.text}</span>{" "}
            {rowActions.notice.link ? (
              <Link href={rowActions.notice.link.href} className="font-[600] underline underline-offset-2">
                {rowActions.notice.link.label}
              </Link>
            ) : null}
          </EAlert>
        ) : null}
        <ECard className="overflow-hidden p-0">
          <EDataTable
            label="Job forms"
            columns={columns}
            rows={payload?.rows ?? []}
            rowKey={(row) => row.id}
            sort={{ key: state.sort, dir: state.dir }}
            onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
            selection={canWrite ? { selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name}` } : undefined}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            minWidth="64rem"
            emptyTitle="No forms here"
            emptyDescription={state.q ? "No form name or question matches this search." : "Nothing matches these filters."}
          />
        </ECard>
        {canWrite ? (
          <FormsBulk selectedIds={selectedIds} groups={groups.groups} onClear={() => setSelected(new Set())} onApplied={refresh} />
        ) : null}
        {payload ? (
          <EPagination
            page={payload.page}
            pageSize={FORMS_PAGE_SIZE}
            total={payload.total}
            onPageChange={(page) => update({ page })}
            disabled={list.loading}
            noun="forms"
          />
        ) : null}
      </section>
      <EConfirmModal
        open={Boolean(rowActions.deleteTarget)}
        onClose={rowActions.cancelDelete}
        title="Delete form template"
        description={
          rowActions.deleteTarget
            ? `“${rowActions.deleteTarget.name}” will be deactivated and unavailable for future jobs. Verify to continue.`
            : undefined
        }
        confirmLabel="Delete template"
        requireSecurity
        danger
        loading={rowActions.deleting}
        onConfirm={rowActions.confirmDelete}
      />
    </div>
  );
}
