"use client";

/**
 * Time and cost tab: planned against actual hours by job type and by
 * property, with overrun counts, and cleaner cost by week (finance only).
 */
import * as React from "react";
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { useQualityRead } from "@/components/v2/admin/quality/hub/use-quality-read";
import { OVERRUN_TOLERANCE_MINUTES } from "@/lib/insights/aggregate";
import type { JobTypeRow } from "@/lib/insights/entities";
import { figureColumns, linksColumn, NameCell } from "./entity-columns";
import { isTimeCost, type PropertyRow, type TimeCostPayload } from "./insights-types";
import { CellFigure } from "./measure-view";
import { SectionState } from "./section-state";
import { WeekColumns } from "./week-columns";

function ratioColumn<T extends { id: string; figures: PropertyRow["figures"] }>(): EDataColumn<T, string> {
  return { key: "ratio", header: "Actual vs planned", align: "right", cell: (row) => <CellFigure measure={row.figures.hours.ratio} format="pct" /> };
}

function unsorted<T>(columns: Array<EDataColumn<T, string>>): Array<EDataColumn<T, string>> {
  return columns.map((column) => ({ ...column, sortKey: undefined }));
}

function jobTypeLabel(jobType: string): string {
  const words = jobType.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function jobTypeColumns(): Array<EDataColumn<JobTypeRow, string>> {
  return unsorted<JobTypeRow>([
    { key: "type", header: "Job type", cell: (row) => <NameCell title={jobTypeLabel(row.jobType)} /> },
    ...figureColumns<JobTypeRow>({ money: false, overruns: true, issues: false }).filter((column) => column.key !== "qa"),
    ratioColumn<JobTypeRow>(),
    linksColumn<JobTypeRow>(),
  ]);
}

function propertyColumns(): Array<EDataColumn<PropertyRow, string>> {
  return unsorted<PropertyRow>([
    { key: "name", header: "Property", cell: (row) => <NameCell title={row.propertyName} subtitle={row.clientName} /> },
    ...figureColumns<PropertyRow>({ money: false, overruns: true, issues: false }).filter((column) => column.key !== "qa"),
    ratioColumn<PropertyRow>(),
    linksColumn<PropertyRow>(),
  ]);
}

function CostChart({ data }: { data: TimeCostPayload }) {
  if (!data.weeklyCost) return null;
  return (
    <ECard className="min-w-0 space-y-3 p-4">
      <h2 className="e-display-sm">Cleaner cost by week</h2>
      <WeekColumns
        title="Cleaner cost by week"
        series={[{ label: "Cleaner cost", kind: "gold" }]}
        weeks={data.weeklyCost.map((week) => ({
          key: week.weekStart,
          label: week.label,
          values: [week.cost],
          note: `${week.basisCount} cleans${week.excludedCount ? `; ${week.excludedCount} excluded (no pay record)` : ""}`,
        }))}
      />
      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Recorded pay per clean (rate snapshot × paid hours, plus approved adjustments), by Monday-start Sydney week.</p>
    </ECard>
  );
}

export function TimeTab({ apiQuery, propertiesHref }: { apiQuery: string; propertiesHref: string }) {
  const read = useQualityRead(`/api/admin/insights/time?${apiQuery}`, isTimeCost, "The time and cost figures could not be loaded.");
  const data = read.data;
  if (!data) return <SectionState loading={read.loading} error={read.error} onRetry={read.reload} label="time and cost figures" />;
  return (
    <div className="space-y-4" aria-busy={read.loading || undefined}>
      {read.error ? <SectionState stale error={read.error} onRetry={read.reload} label="time and cost figures" /> : null}
      <ECard className="min-w-0 overflow-hidden">
        <h2 className="e-display-sm p-4">By job type</h2>
        <EDataTable label="Hours by job type" columns={jobTypeColumns()} rows={data.byJobType} rowKey={(row) => row.id} minWidth="44rem" emptyTitle="No cleans in this period" />
      </ECard>
      <ECard className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h2 className="e-display-sm">By property, most over planned time first</h2>
          <Link href={propertiesHref} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            All {data.byProperty.total} properties
          </Link>
        </div>
        <EDataTable label="Hours by property" columns={propertyColumns()} rows={data.byProperty.rows} rowKey={(row) => row.id} minWidth="44rem" emptyTitle="No cleans in this period" />
      </ECard>
      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        Planned is the allocated time; actual is finished time logs. A clean counts only with both; an overrun is more than{" "}
        {OVERRUN_TOLERANCE_MINUTES} minutes over.
      </p>
      <CostChart data={data} />
    </div>
  );
}
