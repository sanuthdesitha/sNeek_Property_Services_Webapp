"use client";

/**
 * Inspectors tab: the QA performance content as one sortable table, with a
 * drill-down to the issues each inspector raised. The complaint rate is a
 * caution signal (low client feedback after a QA pass), not a score.
 */
import * as React from "react";
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { INSPECTOR_SORTS, titleCaseKey, type InspectorSort, type IssueListFilters, type QualityTab } from "@/lib/quality/types";
import { formatMoney } from "../issues/issue-format";
import type { InspectorRow } from "./hub-types";
import { isInspectors } from "./hub-types";
import { useQualityRead, useReloadOn } from "./use-quality-read";
import { SeverityCountPills } from "./cleaners-cells";

function columns(hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string): Array<EDataColumn<InspectorRow, InspectorSort>> {
  return [
    {
      key: "inspector",
      header: "Inspector",
      sortKey: "inspector",
      cell: (row) => (
        <span>
          <b>{row.name}</b>
          <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{titleCaseKey(row.role)}</span>
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
      cell: (row) => (row.avgOnSiteMinutes === null ? <span className="text-[hsl(var(--e-muted-foreground))]" title="No on-site time recorded">–</span> : <span className="e-tnum">{row.avgOnSiteMinutes} min</span>),
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
      cell: (row) =>
        row.issuesFixedByQA === 0 ? (
          <span className="text-[hsl(var(--e-muted-foreground))]">–</span>
        ) : (
          <span className="e-tnum">{`${row.rectificationMinutes} min · ${formatMoney(row.rectificationCost)}`}</span>
        ),
    },
    { key: "flags", header: "False-confirmation flags", sortKey: "flags", firstDir: "desc", align: "right", cell: (row) => <span className="e-tnum">{row.falseConfirmationsRaised}</span> },
    {
      key: "complaintRate",
      header: "Complaint rate (caution)",
      sortKey: "complaintRate",
      firstDir: "desc",
      cell: (row) =>
        row.caution.complaintRate === null ? (
          <span className="text-[hsl(var(--e-muted-foreground))]" title="No QA-passed jobs in this period">Not enough data</span>
        ) : (
          <span title={`${row.caution.complaints} of ${row.caution.passedJobs} QA-passed jobs drew client feedback of 2 or less`}>
            <EPill tone={row.caution.complaints > 0 ? "warn" : "ok"}>{`${row.caution.complaintRate}%`}</EPill>{" "}
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`${row.caution.complaints}/${row.caution.passedJobs}`}</span>
          </span>
        ),
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

  return (
    <div className="space-y-2">
      <ECard className="overflow-hidden p-0">
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
          minWidth="64rem"
        />
      </ECard>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {read.data?.note ?? "Issue quantity alone is not rewarded — balance found vs fix quality vs misses."} Inspections are completed in
        the period; complaint rate is client feedback of 2 or less on jobs the inspector QA-passed in the period.
      </p>
    </div>
  );
}
