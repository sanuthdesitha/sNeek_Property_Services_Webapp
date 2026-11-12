"use client";

/**
 * Categories tab: issues by category for the period, with the severity split,
 * open fixes and the cleaners behind each category (top three named, the rest
 * counted). Replaces the category × cleaner matrix, which grew a column per
 * cleaner. Each row drills into the Issues tab for that category.
 */
import * as React from "react";
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { CATEGORY_SORTS, type CategorySort, type IssueListFilters, type QualityTab } from "@/lib/quality/types";
import type { CategorySummary } from "./hub-types";
import { isCategories } from "./hub-types";
import { useQualityRead, useReloadOn } from "./use-quality-read";
import { SeverityCountPills } from "./cleaners-cells";

const NAMED_CLEANERS = 3;

function cleanerBreakdown(row: CategorySummary): string {
  const named = row.cleaners.slice(0, NAMED_CLEANERS).map((cleaner) => `${cleaner.name} ${cleaner.count}`);
  const rest = row.cleaners.length - NAMED_CLEANERS;
  return rest > 0 ? `${named.join(" · ")} · +${rest} more` : named.join(" · ");
}

function columns(hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string): Array<EDataColumn<CategorySummary, CategorySort>> {
  return [
    { key: "category", header: "Category", sortKey: "category", cell: (row) => <b>{row.label}</b> },
    { key: "issues", header: "Issues", sortKey: "issues", firstDir: "desc", align: "right", cell: (row) => <span className="e-tnum">{row.total}</span> },
    {
      key: "severity",
      header: "By severity",
      cell: (row) => (
        <SeverityCountPills counts={row.bySeverity} />
      ),
    },
    {
      key: "openFixes",
      header: "Open fixes",
      sortKey: "openFixes",
      firstDir: "desc",
      cell: (row) => (row.openFixes > 0 ? <EPill tone="warn">{`${row.openFixes} open`}</EPill> : <span className="text-[hsl(var(--e-muted-foreground))]">None</span>),
    },
    { key: "cleaners", header: "Cleaners", cell: (row) => <span className="text-[hsl(var(--e-text-secondary))]">{cleanerBreakdown(row)}</span> },
    {
      key: "drill",
      header: <span className="sr-only">Issues</span>,
      cell: (row) => (
        <Link href={hrefForTab("issues", { category: row.category })} className="whitespace-nowrap text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
          View issues
        </Link>
      ),
    },
  ];
}

export function CategoriesTab({
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
  const activeSort: CategorySort = (CATEGORY_SORTS as readonly string[]).includes(sort) ? (sort as CategorySort) : "issues";
  const activeDir = dir || "desc";
  const params = new URLSearchParams(apiQuery);
  params.set("sort", activeSort);
  params.set("dir", activeDir);
  const read = useQualityRead(`/api/admin/quality/categories?${params.toString()}`, isCategories, "Issue categories could not be loaded.");
  useReloadOn(refreshToken, read.reload);
  const tableColumns = React.useMemo(() => columns(hrefForTab), [hrefForTab]);

  return (
    <div className="space-y-2">
      <ECard className="overflow-hidden p-0">
        <EDataTable<CategorySummary, CategorySort>
          label="Issues by category"
          columns={tableColumns}
          rows={read.data?.rows ?? []}
          rowKey={(row) => row.category}
          sort={{ key: activeSort, dir: activeDir }}
          onSortChange={(next) => onSort(next.key, next.dir)}
          loading={read.loading}
          error={read.error}
          onRetry={read.reload}
          emptyTitle="No issues in this period"
          emptyDescription="Change the period or filters."
          minWidth="48rem"
        />
      </ECard>
      {read.data ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`${read.data.issueTotal} issues raised in the period across ${read.data.rows.length} categories.`}</p>
      ) : null}
    </div>
  );
}
