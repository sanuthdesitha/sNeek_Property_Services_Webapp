"use client";

/**
 * Review queue tab: the quick-score list (select all / clear / sort) and the
 * open inspection queue, now paged with its real total instead of the first
 * 12. "Inspect" opens the existing inspection deep link
 * (/v2/admin/quality/[assignmentId]); "QA templates" opens the template page.
 * The period does not apply here: waiting work is live.
 */
import * as React from "react";
import Link from "next/link";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EPill } from "@/components/v2/ui/pill";
import { INSPECTION_SORTS, titleCaseKey, type InspectionSort } from "@/lib/quality/types";
import { QuickScoreQueue } from "../quick-score-queue";
import { formatIssueDate } from "../issues/issue-format";
import type { InspectionQueueRow } from "./hub-types";
import { isInspections } from "./hub-types";
import { useQualityRead, useReloadOn } from "./use-quality-read";

export const INSPECTION_PAGE_SIZE = 20;

function columns(timeZone: string): Array<EDataColumn<InspectionQueueRow, InspectionSort>> {
  return [
    {
      key: "property",
      header: "Property",
      sortKey: "property",
      cell: (row) => (
        <span>
          <b>{row.propertyName}</b>
          {row.suburb ? <span className="text-[hsl(var(--e-muted-foreground))]">, {row.suburb}</span> : null}
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {row.jobType ? titleCaseKey(row.jobType) : "Clean"}
            {row.jobNumber ? ` · Job #${row.jobNumber}` : ""}
          </span>
        </span>
      ),
    },
    { key: "cleaner", header: "Cleaner", cell: (row) => (row.cleanerNames.length ? row.cleanerNames.join(", ") : "Unassigned") },
    { key: "inspector", header: "Inspector", cell: (row) => row.inspectorName ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not picked up</span> },
    { key: "due", header: "Due", sortKey: "due", cell: (row) => (row.dueAt ? formatIssueDate(row.dueAt, timeZone) : <span className="text-[hsl(var(--e-muted-foreground))]">No due date</span>) },
    { key: "created", header: "Queued", sortKey: "created", firstDir: "desc", cell: (row) => formatIssueDate(row.createdAt, timeZone) },
    { key: "status", header: "Status", cell: (row) => <EPill tone={row.status === "IN_PROGRESS" ? "info" : "neutral"}>{titleCaseKey(row.status)}</EPill> },
    {
      key: "inspect",
      header: <span className="sr-only">Inspect</span>,
      align: "right",
      cell: (row) => (
        <EButton asChild variant="gold" size="sm">
          <Link href={`/v2/admin/quality/${row.id}`}>Inspect</Link>
        </EButton>
      ),
    },
  ];
}

export function ReviewTab({
  filterQuery,
  sort,
  dir,
  page,
  quickScoreTotal,
  timeZone,
  refreshToken,
  onSort,
  onPage,
  onChanged,
}: {
  /** Property / search filters only. */
  filterQuery: string;
  sort: string;
  dir: "asc" | "desc" | "";
  page: number;
  quickScoreTotal: number | null;
  timeZone: string;
  refreshToken: number;
  onSort: (sort: string, dir: "asc" | "desc") => void;
  onPage: (page: number) => void;
  onChanged: () => void;
}) {
  const activeSort: InspectionSort = (INSPECTION_SORTS as readonly string[]).includes(sort) ? (sort as InspectionSort) : "due";
  const activeDir = dir || "asc";
  const params = new URLSearchParams(filterQuery);
  params.set("sort", activeSort);
  params.set("dir", activeDir);
  params.set("page", String(page));
  params.set("pageSize", String(INSPECTION_PAGE_SIZE));
  const read = useQualityRead(`/api/admin/quality/inspections?${params.toString()}`, isInspections, "The inspection queue could not be loaded.");
  useReloadOn(refreshToken, read.reload);
  const tableColumns = React.useMemo(() => columns(timeZone), [timeZone]);

  return (
    <div className="space-y-5">
      <QuickScoreQueue filterQuery={filterQuery} totalCandidates={quickScoreTotal} onScored={onChanged} />
      <section aria-labelledby="inspection-queue-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="inspection-queue-heading" className="e-eyebrow">Inspection queue</h2>
          <EButton asChild variant="outline" size="sm">
            <Link href="/v2/admin/qa-templates">QA templates</Link>
          </EButton>
        </div>
        <ECard className="overflow-hidden p-0">
          <EDataTable<InspectionQueueRow, InspectionSort>
            label="Inspection queue"
            columns={tableColumns}
            rows={read.data?.rows ?? []}
            rowKey={(row) => row.id}
            sort={{ key: activeSort, dir: activeDir }}
            onSortChange={(next) => onSort(next.key, next.dir)}
            loading={read.loading}
            error={read.error}
            onRetry={read.reload}
            emptyTitle="No inspections waiting"
            emptyDescription="Every submitted job has been reviewed."
            minWidth="52rem"
          />
        </ECard>
        {read.data ? (
          <EPagination page={read.data.page} pageSize={read.data.pageSize} total={read.data.total} onPageChange={onPage} disabled={read.loading} noun="inspections" />
        ) : null}
      </section>
    </div>
  );
}
