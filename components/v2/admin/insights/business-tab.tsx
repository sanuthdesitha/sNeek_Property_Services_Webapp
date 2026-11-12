"use client";

/**
 * Business tab, as drawn: findings, six figure cards, revenue and cleaner cost
 * by week, and the properties least profitable first.
 *
 * The five-row preview sorts in place: a header click puts the order in the
 * URL (sort / dir on this tab) and reads the first five rows of the WHOLE
 * property set in that order from the Properties endpoint (server-sorted,
 * pageSize 5), so the preview never re-sorts five rows and calls it the top
 * five. "All N properties" opens the full tab in the same order. With no
 * order chosen, the preview is the business payload's own default ranking.
 */
import * as React from "react";
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn, type TableSort } from "@/components/v2/ui/data-table";
import { useQualityRead } from "@/components/v2/admin/quality/hub/use-quality-read";
import { MIN_BASIS_SUMMARY } from "@/lib/insights/measure";
import { PROPERTY_PREVIEW_ROWS, type PropertyOrder } from "@/lib/insights/property-order";
import { FigureCards, FigureDefinitions, FindingsStrip } from "./business-figures";
import { figureColumns, NameCell } from "./entity-columns";
import { isBusiness, isEntityPage, type BusinessPayload, type EntityPage, type PropertyRow } from "./insights-types";
import { ChartLegend, WeekColumns, type ChartSeries } from "./week-columns";
import { SectionState } from "./section-state";

export type PreviewSortControls = {
  sort: string;
  dir: "asc" | "desc" | "";
  onSort: (sort: string, dir: "asc" | "desc") => void;
};

const CHART_SERIES: ChartSeries[] = [
  { label: "Revenue", kind: "primary" },
  { label: "Cleaner cost", kind: "gold" },
];

function previewColumns(money: boolean): Array<EDataColumn<PropertyRow, string>> {
  return [
    { key: "name", header: "Property", sortKey: "name", cell: (row) => <NameCell title={row.propertyName} subtitle={row.clientName} /> },
    ...figureColumns<PropertyRow>({ money: false }),
    ...(money ? figureColumns<PropertyRow>({ money: true }).filter((column) => column.key === "margin") : []),
  ];
}

/** The URL's order when it names a column of this preview; otherwise none (the default ranking). */
export function chosenPreviewOrder(columns: Array<EDataColumn<PropertyRow, string>>, sort: string, dir: string): TableSort<string> | null {
  if (!sort || (dir !== "asc" && dir !== "desc")) return null;
  return columns.some((column) => column.sortKey === sort) ? { key: sort, dir } : null;
}

function MoneyChart({ data }: { data: BusinessPayload }) {
  if (!data.weekly) return null;
  const title = "Revenue and cleaner cost by week";
  return (
    <ECard className="min-w-0 space-y-3 p-4 lg:flex-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[0.8125rem] font-[600]">{title}</h2>
        <ChartLegend series={CHART_SERIES} />
      </div>
      <WeekColumns
        title={title}
        series={CHART_SERIES}
        showLegend={false}
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

function PropertiesPreview({
  data,
  apiQuery,
  sortControls,
  propertiesHref,
}: {
  data: BusinessPayload;
  apiQuery: string;
  sortControls: PreviewSortControls;
  propertiesHref: (sort?: string, dir?: string) => string;
}) {
  const money = data.properties.rankedBy === "margin";
  const columns = previewColumns(money);
  const chosen = chosenPreviewOrder(columns, sortControls.sort, sortControls.dir);
  const defaultOrder: PropertyOrder = data.properties.order;

  const params = new URLSearchParams(apiQuery);
  if (chosen) {
    params.set("sort", chosen.key);
    params.set("dir", chosen.dir);
    params.set("page", "1");
    params.set("pageSize", String(PROPERTY_PREVIEW_ROWS));
  }
  const sorted = useQualityRead<EntityPage<PropertyRow>>(
    chosen ? `/api/admin/insights/properties?${params.toString()}` : null,
    isEntityPage,
    "The properties could not be sorted.",
  );

  // While a new order loads, keep the rows on screen (busy) instead of blanking.
  const lastRows = React.useRef<PropertyRow[]>(data.properties.rows);
  const rows = chosen ? sorted.data?.rows ?? (sorted.error ? [] : lastRows.current) : data.properties.rows;
  React.useEffect(() => {
    if (!chosen || sorted.data) lastRows.current = rows;
  });

  const order = chosen ?? { key: defaultOrder.sort, dir: defaultOrder.dir };
  const title = money ? "Properties, least profitable first" : "Properties, most over planned time first";
  return (
    <ECard className="min-w-0 overflow-hidden lg:flex-[1.4]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <h2 className="text-[0.8125rem] font-[600]">{title}</h2>
        <Link href={propertiesHref(order.key, order.dir)} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
          All {data.properties.total} properties
        </Link>
      </div>
      <EDataTable
        label={title}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort={order}
        onSortChange={(next) => sortControls.onSort(next.key, next.dir)}
        loading={Boolean(chosen) && sorted.loading}
        error={chosen ? sorted.error : null}
        onRetry={sorted.reload}
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
  sortControls,
}: {
  apiQuery: string;
  previousLabel: string | null;
  propertiesHref: (sort?: string, dir?: string) => string;
  sortControls: PreviewSortControls;
}) {
  const read = useQualityRead(`/api/admin/insights/business?${apiQuery}`, isBusiness, "The business figures could not be loaded.");
  const data = read.data;
  if (!data) return <SectionState loading={read.loading} error={read.error} onRetry={read.reload} label="business figures" />;
  return (
    <div className="space-y-4" aria-busy={read.loading || undefined}>
      {read.error ? <SectionState stale error={read.error} onRetry={read.reload} label="business figures" /> : null}
      <FindingsStrip findings={data.findings} />
      <FigureCards cards={data.cards} previousLabel={previousLabel} />
      <FigureDefinitions cards={data.cards} minBasis={MIN_BASIS_SUMMARY} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <MoneyChart data={data} />
        <PropertiesPreview data={data} apiQuery={apiQuery} sortControls={sortControls} propertiesHref={propertiesHref} />
      </div>
    </div>
  );
}
