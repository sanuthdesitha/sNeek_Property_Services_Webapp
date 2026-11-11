"use client";

/**
 * Columns shared by the Insights tables. Each figure cell shows the value or
 * "Not enough data", with its basis in the tooltip; the column set comes from
 * the payload, so money columns appear only when the server sent money.
 */
import * as React from "react";
import Link from "next/link";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { LOW_MARGIN_MAX_PCT } from "@/lib/insights/findings";
import type { EntityFigures, InsightsLink, Measure } from "@/lib/insights/types";
import { CellFigure, formatFigure, revenueSplitNote } from "./measure-view";

/** Display bands for the margin pill (presentation only; the finding floor is LOW_MARGIN_MAX_PCT). */
const MARGIN_WARN_BELOW = 30;
const MARGIN_GOOD_FROM = 45;
/** Actual hours shown in the danger colour at or above this % of planned. */
const HOURS_ALERT_RATIO = 110;

type WithFigures = { id: string; figures: EntityFigures; links: InsightsLink[] };

function marginTone(value: number): EPillTone {
  if (value <= LOW_MARGIN_MAX_PCT) return "bad";
  if (value < MARGIN_WARN_BELOW) return "warn";
  if (value >= MARGIN_GOOD_FROM) return "ok";
  return "neutral";
}

export function MarginCell({ measure }: { measure: Measure | undefined }) {
  if (!measure || measure.value === null) return <CellFigure measure={measure} format="pct" />;
  return (
    <span title={`${measure.basisCount} cleans with both sides; ${measure.excludedCount} excluded`}>
      <EPill tone={marginTone(measure.value)}>{formatFigure(measure.value, "pct")}</EPill>
    </span>
  );
}

function ActualHoursCell({ figures }: { figures: EntityFigures }) {
  const ratio = figures.hours.ratio.value;
  const alert = ratio !== null && ratio >= HOURS_ALERT_RATIO;
  return (
    <span className={alert ? "font-[600] text-[hsl(var(--e-danger))]" : undefined}>
      <CellFigure measure={figures.hours.actualHours} format="hours" />
      {alert ? <span className="sr-only"> (over planned)</span> : null}
    </span>
  );
}

export type ColumnOptions = { money: boolean; issues?: boolean; onTime?: boolean; overruns?: boolean; rework?: boolean };

export function figureColumns<T extends WithFigures>(options: ColumnOptions): Array<EDataColumn<T, string>> {
  const columns: Array<EDataColumn<T, string>> = [
    { key: "cleans", header: "Cleans", sortKey: "cleans", firstDir: "desc", align: "right", cell: (row) => <span className="e-tnum">{row.figures.cleans}</span> },
    { key: "planned", header: "Planned h", sortKey: "planned", firstDir: "desc", align: "right", cell: (row) => <CellFigure measure={row.figures.hours.plannedHours} format="hours" /> },
    { key: "actual", header: "Actual h", sortKey: "actual", firstDir: "desc", align: "right", cell: (row) => <ActualHoursCell figures={row.figures} /> },
  ];
  if (options.overruns) {
    columns.push({
      key: "overruns",
      header: "Overruns",
      sortKey: "overruns",
      firstDir: "desc",
      align: "right",
      cell: (row) => (row.figures.hours.ratio.basisCount > 0 ? <span className="e-tnum">{row.figures.hours.overruns}</span> : <CellFigure measure={row.figures.hours.ratio} format="count" />),
    });
  }
  if (options.onTime) {
    columns.push({ key: "onTime", header: "On time", sortKey: "onTime", firstDir: "desc", align: "right", cell: (row) => <CellFigure measure={row.figures.onTime} format="pct" /> });
  }
  columns.push({ key: "qa", header: "QA", sortKey: "qa", firstDir: "desc", align: "right", cell: (row) => <CellFigure measure={row.figures.qaScore} format="score" /> });
  if (options.issues !== false) {
    columns.push({ key: "issues", header: "Issues", sortKey: "issues", firstDir: "desc", align: "right", cell: (row) => <span className="e-tnum">{row.figures.issues}</span> });
  }
  if (options.rework) {
    columns.push({ key: "rework", header: "Rework", sortKey: "rework", firstDir: "desc", align: "right", cell: (row) => <CellFigure measure={row.figures.reworkRate} format="pct" /> });
  }
  if (options.money) {
    columns.push(
      { key: "revenue", header: "Revenue", sortKey: "revenue", firstDir: "desc", align: "right", cell: (row) => <CellFigure measure={row.figures.money?.revenue} format="aud" note={revenueSplitNote(row.figures.money?.revenueSplit)} /> },
      { key: "margin", header: "Margin", sortKey: "margin", firstDir: "asc", align: "right", cell: (row) => <MarginCell measure={row.figures.money?.margin} /> },
    );
  }
  return columns;
}

export function linksColumn<T extends WithFigures>(): EDataColumn<T, string> {
  return {
    key: "links",
    header: "Records",
    cell: (row) => (
      <span className="flex flex-wrap gap-x-2 text-[0.8125rem]">
        {row.links.map((link) => (
          <Link key={link.href} href={link.href} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            {link.label}
          </Link>
        ))}
      </span>
    ),
  };
}

export function NameCell({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <span className="block min-w-0">
      <span className="block font-[600]">{title}</span>
      {subtitle ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{subtitle}</span> : null}
    </span>
  );
}
