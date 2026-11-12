"use client";

/** Table columns as drawn: Item, Property, Guest, Found, Stored at, Status. */
import { NEW_ITEM_FLAG_DAYS } from "@/lib/lost-found/holding";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { EPill } from "@/components/v2/ui/pill";
import type { LostFoundListRow } from "@/lib/lost-found/list";
import type { LostFoundSort } from "@/lib/lost-found/list-options";
import { formatFoundDay, guestSourceInfo, statusPill } from "./lost-found-format";
import { LostFoundThumb } from "./lost-found-photo";

const muted = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

function ItemCell({ row, onOpen }: { row: LostFoundListRow; onOpen: (row: LostFoundListRow) => void }) {
  const first = row.photos[0];
  const detail = [row.foundLocation, row.photos.length ? `${row.photos.length} photo${row.photos.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {first ? <LostFoundThumb photo={first} alt={row.itemName} className="h-11 w-11" /> : <span aria-hidden className="h-11 w-11 flex-none rounded-[8px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]" />}
      <div className="min-w-0">
        <button type="button" onClick={() => onOpen(row)} className="max-w-full truncate text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
          {row.itemName}
        </button>
        <p className={muted}>{detail || "Location not recorded"}</p>
      </div>
    </div>
  );
}

function GuestCell({ row }: { row: LostFoundListRow }) {
  const source = guestSourceInfo(row);
  if (!row.guestName && source.tone === "none") return <span className={muted}>{source.label}</span>;
  return (
    <div className="min-w-0">
      <p className="truncate">{row.guestName ?? <span className={muted}>Name not recorded</span>}</p>
      <p className={muted}>{source.label}</p>
    </div>
  );
}

export function lostFoundColumns(timeZone: string, onOpen: (row: LostFoundListRow) => void): Array<EDataColumn<LostFoundListRow, LostFoundSort>> {
  return [
    { key: "item", header: "Item", sortKey: "item", className: "min-w-[14rem]", cell: (row) => <ItemCell row={row} onOpen={onOpen} /> },
    { key: "property", header: "Property", sortKey: "property", className: "min-w-[9rem]", cell: (row) => row.propertyName ?? <span className={muted}>No property</span> },
    { key: "guest", header: "Guest", sortKey: "guest", className: "min-w-[9rem]", cell: (row) => <GuestCell row={row} /> },
    { key: "found", header: "Found", sortKey: "found", className: "whitespace-nowrap e-tnum", cell: (row) => formatFoundDay(row.createdAt, timeZone) },
    { key: "stored", header: "Stored at", sortKey: "stored", cell: (row) => row.storageLocation ?? <span className={muted}>Not set</span> },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      cell: (row) => {
        const pill = statusPill(row.status, row.holding, row.unprocessed);
        return (
          <EPill tone={pill.tone}>
            {pill.label}
            {row.holding.past ? <span className="sr-only">, past the holding period</span> : null}
            {row.unprocessed ? <span className="sr-only">, still new after {NEW_ITEM_FLAG_DAYS} days</span> : null}
          </EPill>
        );
      },
    },
  ];
}
