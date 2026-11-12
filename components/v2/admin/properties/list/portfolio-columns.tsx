"use client";

/**
 * Columns of the Properties table as drawn: Property (client under it), Size,
 * Calendar, Next clean, QA 30 d, Flags, one row action (Open, or Fix sync when
 * the calendar sync failed) and the "more" menu. Unknown values are written
 * as words ("Not linked", "None booked", "Not enough data"), never zero.
 */
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { PORTFOLIO_FLAG_LABEL, sizeLabel, type PortfolioRow, type PortfolioSort } from "@/lib/properties/portfolio-options";
import { calendarLabel, FLAG_TONE, nextCleanLabel, qaBasis, qaLabel } from "@/lib/properties/portfolio-format";
import { propertyHref } from "@/lib/properties/links";
import { PropertyMoreMenu } from "../property-more-menu";

export function CalendarCell({ row, now }: { row: PortfolioRow; now: Date }) {
  const label = calendarLabel(row.calendar, now);
  if (!label.tone) return <span className="text-[hsl(var(--e-muted-foreground))]">{label.text}</span>;
  return <EPill tone={label.tone}>{label.text}</EPill>;
}

export function FlagsCell({ row }: { row: PortfolioRow }) {
  if (row.flags.length === 0) return <span className="text-[hsl(var(--e-muted-foreground))]">None</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {row.flags.map((flag) => (
        <EPill key={flag} tone={FLAG_TONE[flag]}>{PORTFOLIO_FLAG_LABEL[flag]}</EPill>
      ))}
    </span>
  );
}

export function portfolioColumns(options: {
  now: Date;
  onOpen: (row: PortfolioRow) => void;
  onArchived: () => void;
}): Array<EDataColumn<PortfolioRow, PortfolioSort>> {
  const { now, onOpen, onArchived } = options;
  return [
    {
      key: "property",
      header: "Property",
      sortKey: "name",
      cell: (row) => (
        <div className="min-w-0">
          <b className="font-[600]">{row.name}</b>
          {row.oneOff ? <EPill className="ml-1.5">One-off site</EPill> : null}
          <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {row.suburb} · {row.clientName}
          </div>
        </div>
      ),
    },
    { key: "size", header: "Size", sortKey: "size", className: "whitespace-nowrap", cell: (row) => sizeLabel(row.bedrooms, row.bathrooms) },
    { key: "calendar", header: "Calendar", sortKey: "calendar", cell: (row) => <CalendarCell row={row} now={now} /> },
    {
      key: "next",
      header: "Next clean",
      sortKey: "nextClean",
      className: "whitespace-nowrap",
      cell: (row) =>
        row.nextClean ? nextCleanLabel(row.nextClean, now) : <span className="text-[hsl(var(--e-muted-foreground))]">None booked</span>,
    },
    {
      key: "qa",
      header: "QA, 30 d",
      sortKey: "qa",
      firstDir: "desc",
      align: "right",
      cell: (row) => (
        <span title={qaBasis(row.qa)} className={row.qa.score === null ? "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]" : "e-tnum"}>
          {qaLabel(row.qa)}
        </span>
      ),
    },
    { key: "flags", header: "Flags", sortKey: "flags", firstDir: "desc", cell: (row) => <FlagsCell row={row} /> },
    {
      key: "action",
      header: <span className="sr-only">Action</span>,
      cell: (row) =>
        row.calendar.kind === "failed" ? (
          <EButton asChild size="sm">
            <Link href={`${propertyHref(row.id)}#calendar-sync`}>Fix sync</Link>
          </EButton>
        ) : (
          <EButton size="sm" variant="outline" onClick={() => onOpen(row)} aria-label={`Open ${row.name}`}>
            Open
          </EButton>
        ),
    },
    {
      key: "more",
      header: <span className="sr-only">More</span>,
      className: "w-[34px]",
      cell: (row) => <PropertyMoreMenu propertyId={row.id} propertyName={row.name} onArchived={onArchived} includeOpen />,
    },
  ];
}
