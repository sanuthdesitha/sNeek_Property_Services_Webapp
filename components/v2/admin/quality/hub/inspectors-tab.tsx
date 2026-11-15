"use client";

/**
 * Inspectors tab (board "QualitySubpages", Inspectors tab; board
 * "M-QualityDetail", frame 6): the QA performance content as one sortable
 * table, with a drill-down to the issues each inspector raised. The complaint
 * rate is a caution signal (low client feedback after a QA pass), not a score.
 * Empty values read "Not recorded", "None" or "Not enough data", never 0.
 * On a phone the table becomes read-only cards with the same server sort.
 *
 * Office only: the route is ADMIN / OPS_MANAGER, so a QA inspector never sees
 * another inspector's figures (owner default, pending confirmation).
 */
import * as React from "react";
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { INSPECTOR_SORTS, titleCaseKey, type InspectorSort, type IssueListFilters, type QualityTab } from "@/lib/quality/types";
import type { InspectorRow } from "./hub-types";
import { isInspectors } from "./hub-types";
import { useQualityRead, useReloadOn } from "./use-quality-read";
import { SeverityCountPills } from "./cleaners-cells";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { PhoneTableBar } from "@/components/v2/ui/data-table-phone";
import { formatAud } from "@/lib/quality/issue-presentation";

const ROLE_LABEL: Readonly<Record<string, string>> = {
  QA_INSPECTOR: "QA inspector",
  ADMIN: "Admin",
  OPS_MANAGER: "Operations manager",
  CLEANER: "Cleaner",
};

export function inspectorRoleLabel(role: string): string {
  return ROLE_LABEL[role] ?? titleCaseKey(role);
}

const MUTED = "text-[hsl(var(--e-muted-foreground))]";

function complaintsText(row: InspectorRow): string {
  const { complaints } = row.caution;
  return complaints === 0 ? "no complaints" : complaints === 1 ? "1 complaint" : `${complaints} complaints`;
}

function ComplaintCell({ row }: { row: InspectorRow }) {
  if (row.caution.complaintRate === null) {
    return (
      <span className="block">
        <span className="block">Not enough data</span>
        <span className={`block text-[0.75rem] ${MUTED}`}>no passed cleans in this period</span>
      </span>
    );
  }
  return (
    <span className="block" title={`${row.caution.complaints} of ${row.caution.passedJobs} QA-passed jobs drew client feedback of 2 or less`}>
      <EPill tone={row.caution.complaints > 0 ? "warn" : "ok"}>{`${row.caution.complaintRate}% · ${complaintsText(row)}`}</EPill>
      <span className={`block text-[0.75rem] ${MUTED}`}>{`${row.caution.complaints} of ${row.caution.passedJobs} passed cleans`}</span>
    </span>
  );
}

function rectificationText(row: InspectorRow): string | null {
  return row.issuesFixedByQA === 0 ? null : `${row.rectificationMinutes} min · ${formatAud(row.rectificationCost)}`;
}

function columns(hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string): Array<EDataColumn<InspectorRow, InspectorSort>> {
  return [
    {
      key: "inspector",
      header: "Inspector",
      sortKey: "inspector",
      cell: (row) => (
        <span>
          <b>{row.name}</b>
          <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{inspectorRoleLabel(row.role)}</span>
        </span>
      ),
    },
    { key: "inspections", header: "Inspections", sortKey: "inspections", firstDir: "desc", align: "right", cell: (row) => <span className="e-tnum">{row.inspectionsCompleted}</span> },
    {
      key: "onSite",
      header: "Avg on site",
      sortKey: "onSite",
      firstDir: "desc",
      align: "right",
      cell: (row) => (row.avgOnSiteMinutes === null ? <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span> : <span className="e-tnum">{row.avgOnSiteMinutes} min</span>),
    },
    {
      key: "issues",
      header: "Issues found",
      sortKey: "issues",
      firstDir: "desc",
      cell: (row) =>
        row.issuesFound.total === 0 ? (
          <span className="text-[hsl(var(--e-muted-foreground))]">None</span>
        ) : (
          <SeverityCountPills counts={row.issuesFound} />
        ),
    },
    { key: "fixed", header: "Fixed by QA", sortKey: "fixed", firstDir: "desc", align: "right", cell: (row) => <span className="e-tnum">{row.issuesFixedByQA}</span> },
    {
      key: "rectificationCost",
      header: "Rectification",
      sortKey: "rectificationCost",
      firstDir: "desc",
      align: "right",
      cell: (row) => {
        const text = rectificationText(row);
        return text === null ? <span className="text-[hsl(var(--e-muted-foreground))]">None</span> : <span className="e-tnum">{text}</span>;
      },
    },
    { key: "flags", header: "False-confirmation flags", sortKey: "flags", firstDir: "desc", align: "right", cell: (row) => <span className="e-tnum">{row.falseConfirmationsRaised}</span> },
    {
      key: "complaintRate",
      header: "Complaint rate (caution)",
      sortKey: "complaintRate",
      firstDir: "desc",
      cell: (row) => <ComplaintCell row={row} />,
    },
    {
      key: "drill",
      header: <span className="sr-only">Issues</span>,
      cell: (row) =>
        row.issuesFound.total > 0 ? (
          <Link href={hrefForTab("issues", { raisedById: row.inspectorId })} className="whitespace-nowrap text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            View issues
          </Link>
        ) : null,
    },
  ];
}

export function InspectorsTab({
  apiQuery,
  sort,
  dir,
  refreshToken,
  hrefForTab,
  onSort,
}: {
  apiQuery: string;
  sort: string;
  dir: "asc" | "desc" | "";
  refreshToken: number;
  hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string;
  onSort: (sort: string, dir: "asc" | "desc") => void;
}) {
  const activeSort: InspectorSort = (INSPECTOR_SORTS as readonly string[]).includes(sort) ? (sort as InspectorSort) : "issues";
  const activeDir = dir || "desc";
  const params = new URLSearchParams(apiQuery);
  params.set("sort", activeSort);
  params.set("dir", activeDir);
  const read = useQualityRead(`/api/admin/quality/inspectors?${params.toString()}`, isInspectors, "Inspector performance could not be loaded.");
  useReloadOn(refreshToken, read.reload);
  const tableColumns = React.useMemo(() => columns(hrefForTab), [hrefForTab]);
  const phone = useIsPhone();

  return (
    <div className="space-y-2">
      {phone ? (
        <InspectorCards
          rows={read.data?.rows ?? null}
          loading={read.loading}
          error={read.error}
          onRetry={read.reload}
          columns={tableColumns}
          sort={{ key: activeSort, dir: activeDir }}
          onSort={onSort}
          hrefForTab={hrefForTab}
        />
      ) : null}
      <ECard className="overflow-hidden p-0 max-sm:hidden">
        <EDataTable<InspectorRow, InspectorSort>
          label="Inspectors"
          columns={tableColumns}
          rows={read.data?.rows ?? []}
          rowKey={(row) => row.inspectorId}
          sort={{ key: activeSort, dir: activeDir }}
          onSortChange={(next) => onSort(next.key, next.dir)}
          loading={read.loading}
          error={read.error}
          onRetry={read.reload}
          emptyTitle="No inspectors match"
          emptyDescription="No active QA inspectors and no issues raised for these filters."
          minWidth="60rem"
        />
      </ECard>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Issue count alone is not rewarded: read found, fixed and missed together. &quot;Not recorded&quot; means no on-site time was
        captured (remote reviews), never zero minutes. Inspections are completed in the period; complaint rate is client feedback of 2
        or less on jobs the inspector QA-passed in the period, and is a caution signal, not a score.
      </p>
    </div>
  );
}

function CardTile({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-2.5 py-2">
      <dd className="text-[0.9375rem] font-[600] e-tnum">{value}</dd>
      <dt className={`text-[0.75rem] ${MUTED}`}>{label}</dt>
    </div>
  );
}

function cardPill(row: InspectorRow): { text: string; tone: "warn" | "ok" | "neutral" } {
  if (row.caution.complaintRate === null) return { text: "Not enough data", tone: "neutral" };
  if (row.caution.complaints === 0) return { text: "No complaints", tone: "ok" };
  return { text: `Complaints ${row.caution.complaintRate}%`, tone: "warn" };
}

/** Phones (board "M-QualityDetail", frame 6): read-only cards, sorted on the server like the table. */
function InspectorCards({
  rows,
  loading,
  error,
  onRetry,
  columns: sortColumns,
  sort,
  onSort,
  hrefForTab,
}: {
  rows: InspectorRow[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  columns: Array<EDataColumn<InspectorRow, InspectorSort>>;
  sort: { key: InspectorSort; dir: "asc" | "desc" };
  onSort: (sort: string, dir: "asc" | "desc") => void;
  hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string;
}) {
  return (
    <div className="space-y-2 sm:hidden">
      <ECard className="overflow-hidden p-0">
        <PhoneTableBar columns={sortColumns} sort={sort} onSortChange={(next) => onSort(next.key, next.dir)} label="inspectors" selecting={false} />
      </ECard>
      {error ? (
        <div role="alert" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3 text-[0.875rem]">
          {rows?.length ? "Showing the last figures that loaded. " : ""}
          {error}{" "}
          <button type="button" className="underline" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
      {!rows && loading ? <p role="status" className={`text-[0.875rem] ${MUTED}`}>Loading inspectors…</p> : null}
      {rows && rows.length === 0 && !error ? <p className={`text-[0.875rem] ${MUTED}`}>No inspectors match these filters.</p> : null}
      {(rows ?? []).map((row) => {
        const pill = cardPill(row);
        const fixed = rectificationText(row);
        return (
          <ECard key={row.inspectorId} className="space-y-2.5 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-[650] [overflow-wrap:anywhere]">{row.name}</p>
                <p className={`text-[0.8125rem] ${MUTED}`}>{inspectorRoleLabel(row.role)}</p>
              </div>
              <EPill tone={pill.tone}>{pill.text}</EPill>
            </div>
            <dl className="grid grid-cols-3 gap-2">
              <CardTile value={row.inspectionsCompleted} label="inspections" />
              <CardTile value={row.avgOnSiteMinutes === null ? "Not recorded" : `${row.avgOnSiteMinutes} min`} label="avg on site" />
              <CardTile value={row.falseConfirmationsRaised} label="false-conf. flags" />
            </dl>
            <div className="space-y-1 text-[0.8125rem]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={MUTED}>Found</span>
                {row.issuesFound.total === 0 ? <span>No issues found</span> : <SeverityCountPills counts={row.issuesFound} />}
              </div>
              <p>
                <span className={MUTED}>Fixed by QA </span>
                <span className="e-tnum">{row.issuesFixedByQA}</span>
                {fixed ? <span className="e-tnum"> · {fixed}</span> : null}
              </p>
            </div>
            {row.issuesFound.total > 0 ? (
              <Link href={hrefForTab("issues", { raisedById: row.inspectorId })} className="inline-flex min-h-11 items-center text-[0.875rem] text-[hsl(var(--e-primary))] underline underline-offset-2">
                View issues
              </Link>
            ) : null}
          </ECard>
        );
      })}
    </div>
  );
}
