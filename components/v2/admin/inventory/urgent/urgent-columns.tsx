"use client";

/**
 * Table columns as drawn: Item (with "Reported by … during job …"), Property,
 * On hand, To buy, Needed by, Stage (with the run or ask under it), Next
 * action. An acknowledged need not yet on a run offers "Add to shopping run",
 * as drawn; every other stage offers its one transition.
 */
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import type { UrgentNeedListRow } from "@/lib/inventory/urgent-stock-list";
import { URGENT_STAGE_LABEL, urgentNextAction, type UrgentSort } from "@/lib/inventory/urgent-stock-actions";
import { neededByLabel, quantity, reportedWhen, STAGE_TONE } from "./urgent-format";
import { needLinkSummary, ReportedBy } from "./need-links";

export type UrgentColumnHandlers = { open: (row: UrgentNeedListRow) => void; act: (row: UrgentNeedListRow) => void; addToRun: (row: UrgentNeedListRow) => void };

/** Acknowledged, not on a run and nobody asked: the drawn next step is the shopping run. */
export function offersAddToRun(row: Pick<UrgentNeedListRow, "stage" | "shoppingRun" | "purchaseAsk">): boolean {
  const liveAsk = row.purchaseAsk && (row.purchaseAsk.state === "ASKED" || row.purchaseAsk.state === "ACCEPTED");
  return row.stage === "ACKNOWLEDGED" && !row.shoppingRun && !liveAsk;
}

const muted = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

export function urgentColumns(timeZone: string, handlers: UrgentColumnHandlers): Array<EDataColumn<UrgentNeedListRow, UrgentSort>> {
  return [
    {
      key: "item",
      header: "Item",
      sortKey: "item",
      className: "min-w-[12rem]",
      cell: (row) => (
        <div className="min-w-0">
          <button type="button" onClick={() => handlers.open(row)} className="text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">{row.itemName}</button>
          <p className={muted}><ReportedBy row={row} suffix={`, ${reportedWhen(row.createdAt, timeZone)}`} /></p>
        </div>
      ),
    },
    { key: "property", header: "Property", sortKey: "property", className: "min-w-[9rem]", cell: (row) => row.propertyName },
    {
      key: "onHand",
      header: "On hand",
      sortKey: "onHand",
      firstDir: "asc",
      align: "right",
      className: "e-tnum whitespace-nowrap",
      cell: (row) => row.observedCount === null ? <span className={muted}>Unknown</span> : <span className={row.observedCount === 0 ? "font-[600] text-[hsl(var(--e-danger))]" : undefined}>{row.observedCount}</span>,
    },
    { key: "toBuy", header: "To buy", sortKey: "toBuy", align: "right", className: "e-tnum whitespace-nowrap", cell: (row) => row.purchaseQuantity === null ? <span className={muted}>Unknown</span> : quantity(row.purchaseQuantity, row.unit) },
    {
      key: "neededBy",
      header: "Needed by",
      sortKey: "neededBy",
      className: "whitespace-nowrap",
      cell: (row) => {
        const label = neededByLabel(row.neededBy, row.neededByState, timeZone);
        const content = <>{label.text}{label.srText ? <span className="sr-only">, {label.srText}</span> : null}</>;
        return label.tone ? <EPill tone={label.tone}>{content}</EPill> : <span>{content}</span>;
      },
    },
    {
      key: "stage",
      header: "Stage",
      sortKey: "stage",
      cell: (row) => {
        const summary = needLinkSummary(row);
        return (
          <div className="min-w-0">
            <EPill tone={STAGE_TONE[row.stage]}>{URGENT_STAGE_LABEL[row.stage]}</EPill>
            {summary ? <p className={`${muted} mt-0.5 max-w-[14rem] truncate`} title={summary}>{summary}</p> : null}
          </div>
        );
      },
    },
    {
      key: "next",
      header: "Next action",
      cell: (row) => {
        if (offersAddToRun(row)) return <EButton size="sm" variant="outline" onClick={() => handlers.addToRun(row)}>Add to shopping run</EButton>;
        const next = urgentNextAction(row.stage);
        if (next.kind !== "transition") return <span className={muted}>{next.label}</span>;
        return <EButton size="sm" variant={row.stage === "REPORTED" ? "primary" : "outline"} onClick={() => handlers.act(row)}>{next.label}</EButton>;
      },
    },
  ];
}
