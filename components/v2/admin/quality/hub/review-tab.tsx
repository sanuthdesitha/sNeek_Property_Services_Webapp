"use client";

/**
 * Review queue tab: the quick-score list (select all / clear / sort) and the
 * open inspection queue, now paged with its real total instead of the first
 * 12. "Inspect" opens the existing inspection deep link
 * (/v2/admin/quality/[assignmentId]); "QA templates" opens the template page.
 * The period does not apply here: waiting work is live. The old page's
 * counters (Awaiting QA, In progress, Completed today in the organisation's
 * timezone) head the queue again (parity audit 2026-11-12).
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
import type { InspectionQueueRow, InspectionsPayload } from "./hub-types";
import { isInspections } from "./hub-types";
import { useQualityRead, useReloadOn } from "./use-quality-read";
import { useIsPhone } from "@/components/v2/ui/use-phone";

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

function QueueCounters({ counters }: { counters: NonNullable<InspectionsPayload["counters"]> }) {
  const phone = useIsPhone();
  const items = [
    { label: "Awaiting QA", value: counters.awaiting, note: "not picked up" },
    { label: "In progress", value: counters.inProgress, note: "being inspected" },
    { label: "Completed today", value: counters.completedToday, note: "inspections closed" },
  ];
  if (phone) {
    // Phones: the three counts on one line (board "M-PeopleQuality").
    return (
      <dl aria-label="Inspection queue counts" className="flex flex-wrap gap-x-3 gap-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline gap-1">
            <dt>{item.label}</dt>
            <dd className="e-tnum font-[650] text-[hsl(var(--e-foreground))]">{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl aria-label="Inspection queue counts" className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2.5">
          <dt className="e-eyebrow text-[0.65625rem] text-[hsl(var(--e-gold-ink))]">{item.label}</dt>
          <dd className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="e-numeral text-[1.5rem] leading-none e-tnum">{item.value}</span>
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
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
        {read.data?.counters ? <QueueCounters counters={read.data.counters} /> : null}
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
