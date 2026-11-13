"use client";

/**
 * Issues tab: server-paged and server-sorted QA issues with the real total,
 * the tab's own status filters, bulk "Mark fixed" and CSV export. A row opens
 * the issue detail with its photos and every existing action. QA inspectors
 * see the list and the detail read-only (no selection, no actions).
 */
import * as React from "react";
import { Download } from "lucide-react";
import { ECard, EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { ESelect } from "@/components/v2/admin/estate-kit";
import {
  FALSE_CONFIRMATION_STATUSES,
  ISSUE_SEVERITIES,
  ISSUE_SORTS,
  RECTIFICATION_STATUSES,
  titleCaseKey,
  type IssueListFilters,
  type IssueSort,
} from "@/lib/quality/types";
import type { HubContext, QualityIssueRow } from "./hub-types";
import { isIssues } from "./hub-types";
import { issueColumns } from "./issue-columns";
import { IssueBulkBar } from "./issue-bulk";
import { useQualityRead, useReloadOn } from "./use-quality-read";
import { severityLabel } from "@/lib/quality/severity";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import type { EActiveFilter } from "@/components/v2/ui/filter-bar";
import type { IssueActionKey } from "../issues/issue-actions";
import { issuePhoneActionsColumn } from "./issue-columns";

export const ISSUE_PAGE_SIZE = 25;

function StatusFilter<T extends string>({
  label,
  value,
  values,
  optionLabel = titleCaseKey,
  onChange,
}: {
  label: string;
  value: T | "";
  values: readonly T[];
  /** Display text for a value; the option value and the URL keep the stored value. */
  optionLabel?: (value: T) => string;
  onChange: (value: T | "") => void;
}) {
  return (
    <EFilterPopover label={label} value={value ? optionLabel(value) : null}>
      <label className="block space-y-1 text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">
        {label}
        <ESelect value={value} onChange={(event) => onChange(event.target.value as T | "")}>
          <option value="">Any</option>
          {values.map((option) => (
            <option key={option} value={option}>
              {optionLabel(option)}
            </option>
          ))}
        </ESelect>
      </label>
    </EFilterPopover>
  );
}

/** The Issues tab's own status filters (inline from 640px; in the hub's filter sheet on a phone). */
export function IssueStatusFilters({ filters, onFilters }: { filters: IssueListFilters; onFilters: (patch: Partial<IssueListFilters>) => void }) {
  return (
    <>
      <StatusFilter label="Severity" value={filters.severity} values={ISSUE_SEVERITIES} optionLabel={severityLabel} onChange={(severity) => onFilters({ severity })} />
      <StatusFilter
        label="Rectification"
        value={filters.rectificationStatus}
        values={RECTIFICATION_STATUSES}
        onChange={(rectificationStatus) => onFilters({ rectificationStatus })}
      />
      <StatusFilter
        label="False confirmation"
        value={filters.falseConfirmation}
        values={FALSE_CONFIRMATION_STATUSES}
        onChange={(falseConfirmation) => onFilters({ falseConfirmation })}
      />
    </>
  );
}

/** Chips for the status filters in use (the phone filter bar). */
export function issueStatusActiveFilters(filters: IssueListFilters, onFilters: (patch: Partial<IssueListFilters>) => void): EActiveFilter[] {
  const active: EActiveFilter[] = [];
  if (filters.severity) active.push({ key: "severity", label: `Severity: ${severityLabel(filters.severity)}`, onRemove: () => onFilters({ severity: "" }) });
  if (filters.rectificationStatus) {
    active.push({ key: "rectification", label: `Rectification: ${titleCaseKey(filters.rectificationStatus)}`, onRemove: () => onFilters({ rectificationStatus: "" }) });
  }
  if (filters.falseConfirmation) {
    active.push({ key: "falseConfirmation", label: `False confirmation: ${titleCaseKey(filters.falseConfirmation)}`, onRemove: () => onFilters({ falseConfirmation: "" }) });
  }
  return active;
}

export function IssuesTab({
  apiQuery,
  filters,
  sort,
  dir,
  page,
  context,
  labelFor,
  refreshToken,
  onFilters,
  onSort,
  onPage,
  onOpenIssue,
  onOpenIssueAction,
  onChanged,
}: {
  /** Period + shared filters + the tab's own status filters, serialised. */
  apiQuery: string;
  filters: IssueListFilters;
  sort: string;
  dir: "asc" | "desc" | "";
  page: number;
  context: HubContext;
  labelFor: (key: string) => string;
  refreshToken: number;
  onFilters: (patch: Partial<IssueListFilters>) => void;
  onSort: (sort: string, dir: "asc" | "desc") => void;
  onPage: (page: number) => void;
  onOpenIssue: (issue: QualityIssueRow) => void;
  /** Phones: open the issue on one of its actions (the card's Mark fixed and "⋯"). */
  onOpenIssueAction?: (issue: QualityIssueRow, action: IssueActionKey) => void;
  onChanged: () => void;
}) {
  const activeSort: IssueSort = (ISSUE_SORTS as readonly string[]).includes(sort) ? (sort as IssueSort) : "created";
  const activeDir = dir || "desc";
  const params = new URLSearchParams(apiQuery);
  params.set("sort", activeSort);
  params.set("dir", activeDir);
  params.set("page", String(page));
  params.set("pageSize", String(ISSUE_PAGE_SIZE));
  const read = useQualityRead(`/api/admin/quality/issues?${params.toString()}`, isIssues, "QA issues could not be loaded.");
  useReloadOn(refreshToken, read.reload);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const seen = React.useRef(new Map<string, string>());
  // A different filter set or sort is a different list: clear the selection.
  const signature = `${apiQuery}|${activeSort}|${activeDir}`;
  React.useEffect(() => setSelected(new Set()), [signature]);

  const rows = read.data?.rows ?? [];
  for (const row of rows) seen.current.set(row.id, `${labelFor(row.category)} (${row.cleaner?.name ?? "cleaner"})`);
  const phone = useIsPhone();
  const phoneActions = phone && context.canManage && onOpenIssueAction ? onOpenIssueAction : null;
  const columns = React.useMemo(() => {
    const base = issueColumns({ labelFor, timeZone: context.timeZone, onOpen: onOpenIssue });
    // Phones only: each card carries its actions (board "M-PeopleQuality"); the desktop table is unchanged.
    return phoneActions ? [...base, issuePhoneActionsColumn({ labelFor, onOpen: onOpenIssue, onAction: phoneActions })] : base;
  }, [labelFor, context.timeZone, onOpenIssue, phoneActions]);
  const exportParams = new URLSearchParams(apiQuery);
  exportParams.set("sort", activeSort);
  exportParams.set("dir", activeDir);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Phones: the status filters are in the hub's one filter sheet. */}
        {phone ? null : <IssueStatusFilters filters={filters} onFilters={onFilters} />}
        <span className="min-w-0 flex-1" />
        <EButton asChild size="sm" variant="outline">
          <a href={`/api/admin/quality/issues/export?${exportParams.toString()}`} download>
            <Download aria-hidden className="h-3.5 w-3.5" /> Export CSV
          </a>
        </EButton>
      </div>

      {context.canManage ? (
        <IssueBulkBar selected={selected} onSelectionChange={setSelected} onDone={onChanged} describe={(id) => seen.current.get(id) ?? "Issue"} />
      ) : null}

      <ECard className="overflow-hidden p-0">
        <EDataTable<QualityIssueRow, IssueSort>
          label="QA issues"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          sort={{ key: activeSort, dir: activeDir }}
          onSortChange={(next) => onSort(next.key, next.dir)}
          selection={
            context.canManage
              ? {
                  selected,
                  onChange: setSelected,
                  rowLabel: (row) => `Select ${labelFor(row.category)} for ${row.cleaner?.name ?? "cleaner"}`,
                }
              : undefined
          }
          loading={read.loading}
          error={read.error}
          onRetry={read.reload}
          emptyTitle="No QA issues match"
          emptyDescription="Change the period or filters, or check back after the next inspection."
          minWidth="60rem"
        />
      </ECard>
      {read.data ? (
        <EPagination page={read.data.page} pageSize={read.data.pageSize} total={read.data.total} onPageChange={onPage} disabled={read.loading} noun="issues" />
      ) : null}
    </div>
  );
}
