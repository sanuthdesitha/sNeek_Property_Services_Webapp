"use client";

/**
 * Business tab, as drawn: findings, six figure cards, revenue and cleaner cost
 * by week, and the properties least profitable first. Sorting the preview
 * opens the full Properties tab in that order (the preview is five rows, not
 * the whole list, so it is never re-sorted in place).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ECard } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { useQualityRead } from "@/components/v2/admin/quality/hub/use-quality-read";
import { MIN_BASIS_SUMMARY } from "@/lib/insights/measure";
import { FigureCards, FindingsStrip } from "./business-figures";
import { figureColumns, NameCell } from "./entity-columns";
import { isBusiness, type BusinessPayload, type PropertyRow } from "./insights-types";
import { WeekColumns } from "./week-columns";
import { SectionState } from "./section-state";

function previewColumns(money: boolean): Array<EDataColumn<PropertyRow, string>> {
  return [
    { key: "name", header: "Property", sortKey: "name", cell: (row) => <NameCell title={row.propertyName} subtitle={row.clientName} /> },
    ...figureColumns<PropertyRow>({ money: false }),
    ...(money ? figureColumns<PropertyRow>({ money: true }).filter((column) => column.key === "margin") : []),
  ];
}

function MoneyChart({ data }: { data: BusinessPayload }) {
  if (!data.weekly) return null;
  return (
    <ECard className="min-w-0 space-y-3 p-4 lg:flex-1">
      <h2 className="e-display-sm">Revenue and cleaner cost by week</h2>
      <WeekColumns
        title="Revenue and cleaner cost by week"
        series={[{ label: "Revenue", kind: "primary" }, { label: "Cleaner cost", kind: "gold" }]}
        weeks={data.weekly.map((week) => ({
          key: week.weekStart,
          label: week.label,
          values: [week.revenue, week.cost],
          note: `${week.basisCount} cleans${week.excludedCount ? `; ${week.excludedCount} excluded` : ""}`,
        }))}
      />
      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        Weeks start on Monday (Sydney). Each week counts only cleans with both a charge (invoiced, or the scheduled charge
        where not yet invoiced) and recorded pay, so the two bars compare the same cleans.
      </p>
    </ECard>
  );
}

function PropertiesPreview({ data, propertiesHref }: { data: BusinessPayload; propertiesHref: (sort?: string, dir?: string) => string }) {
  const router = useRouter();
  const money = data.properties.rankedBy === "margin";
  const title = money ? "Properties, least profitable first" : "Properties, most over planned time first";
  return (
    <ECard className="min-w-0 overflow-hidden lg:flex-[1.4]">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <h2 className="e-display-sm">{title}</h2>
        <Link href={propertiesHref()} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
          All {data.properties.total} properties
        </Link>
      </div>
      <EDataTable
        label={title}
        columns={previewColumns(money)}
        rows={data.properties.rows}
        rowKey={(row) => row.id}
        sort={money ? { key: "margin", dir: "asc" } : null}
        onSortChange={(next) => router.push(propertiesHref(next.key, next.dir))}
        minWidth="36rem"
        emptyTitle="No cleans in this period"
      />
      {money ? null : (
        <p className="px-4 py-2 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Margin needs finance access.</p>
      )}
    </ECard>
  );
}

export function BusinessTab({
  apiQuery,
  previousLabel,
  propertiesHref,
}: {
  apiQuery: string;
  previousLabel: string | null;
  propertiesHref: (sort?: string, dir?: string) => string;
}) {
  const read = useQualityRead(`/api/admin/insights/business?${apiQuery}`, isBusiness, "The business figures could not be loaded.");
  const data = read.data;
  if (!data) return <SectionState loading={read.loading} error={read.error} onRetry={read.reload} label="business figures" />;
  return (
    <div className="space-y-4" aria-busy={read.loading || undefined}>
      {read.error ? <SectionState stale error={read.error} onRetry={read.reload} label="business figures" /> : null}
      <FindingsStrip findings={data.findings} />
      <FigureCards cards={data.cards} previousLabel={previousLabel} />
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Every figure counts only the cleans that carry its inputs and says how many were left out and why. Below{" "}
        {MIN_BASIS_SUMMARY} supporting records a figure shows &ldquo;Not enough data&rdquo; and no change.
      </p>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <MoneyChart data={data} />
        <PropertiesPreview data={data} propertiesHref={propertiesHref} />
      </div>
    </div>
  );
}
