/**
 * Small display parts shared by the pay record pages: the facts row, the
 * history list and the side card. No hooks and no "use client", so a server
 * page may render them too. Estate tokens only; flagged things use the tone
 * band (components/v2/ui/tone-band.tsx), never a coloured left line.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { stamp } from "./format";

export const MUTED = "text-[hsl(var(--e-muted-foreground))]";
export const SMALL = "text-[0.8125rem]";

export type FactTile = {
  key: string;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  /** The tile that closes the row (grand total). */
  gold?: boolean;
  /** The note is a warning ("6 of 7 bought lines costed"). */
  noteTone?: "warning";
};

/** Tiles from 640px; on a phone one card with the closing (gold) figure first, as the phone boards draw it. */
export function FactTiles({ label, tiles, className }: { label: string; tiles: FactTile[]; className?: string }) {
  const lead = tiles.find((tile) => tile.gold);
  const rest = tiles.filter((tile) => tile !== lead);
  return (
    <>
      <section aria-label={label} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3.5 py-2.5 sm:hidden">
        {lead ? (
          <p className="flex items-baseline justify-between gap-2 border-b border-[hsl(var(--e-border))] pb-2">
            <span className={cn(SMALL, MUTED)}>{lead.label}</span>
            <b className="e-tnum text-[1.25rem] text-[hsl(var(--e-gold-ink))]">{lead.value}</b>
          </p>
        ) : null}
        <dl className="divide-y divide-[hsl(var(--e-border))]">
          {rest.map((tile) => (
            <div key={tile.key} className={cn("flex items-baseline justify-between gap-3 py-1.5", SMALL)}>
              <dt className={MUTED}>{tile.label}</dt>
              <dd className="text-right">
                <b className="e-tnum">{tile.value}</b>
                {tile.note && tile.noteTone === "warning" ? <span className="ml-1 font-[600] text-[hsl(var(--e-warning))]">({tile.note})</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <FactTileGrid label={label} tiles={tiles} className={className} />
    </>
  );
}

function FactTileGrid({ label, tiles, className }: { label: string; tiles: FactTile[]; className?: string }) {
  return (
    <section aria-label={label} className={cn("grid grid-cols-2 gap-2.5 max-sm:hidden sm:grid-cols-3 lg:grid-cols-5", className)}>
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className={cn(
            "min-w-0 rounded-[var(--e-radius-lg)] border px-3.5 py-3",
            tile.gold
              ? "border-[hsl(var(--e-border-gold)/0.45)] bg-[hsl(var(--e-gold-soft))]"
              : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
          )}
        >
          <p className={cn("text-[0.75rem]", MUTED)}>{tile.label}</p>
          <p className={cn("e-tnum mt-0.5 text-[1.0625rem] font-[600] leading-tight", tile.gold && "text-[hsl(var(--e-gold-ink))]")}>{tile.value}</p>
          {tile.note ? (
            <p className={cn("mt-0.5 text-[0.75rem] leading-snug", tile.noteTone === "warning" ? "font-[600] text-[hsl(var(--e-warning))]" : MUTED)}>{tile.note}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

export type HistoryLine = { id: string; at: string; label: string; actor?: string | null };

/** History, newest first, in the organisation timezone. An unreadable history says so; it is never an empty list. */
export function HistoryList({ entries, timezone, empty = "Nothing recorded yet." }: { entries: HistoryLine[] | { error: string }; timezone: string; empty?: string }) {
  if ("error" in entries) {
    return <p role="alert" className={cn(SMALL, "text-[hsl(var(--e-danger))]")}>History could not be read: {entries.error}</p>;
  }
  if (!entries.length) return <p className={cn(SMALL, MUTED)}>{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li key={entry.id} className={cn("grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2", SMALL)}>
          <span className={cn("e-tnum", MUTED)}>{stamp(entry.at, timezone)}</span>
          <span className="break-words">
            {entry.label}
            {entry.actor ? <span className={MUTED}> · {entry.actor}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A rail card with an h2. */
export function RailCard({ title, children, className, ...rest }: { title: React.ReactNode; children: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={cn("min-w-0 space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5", className)} {...rest}>
      <h2 className="text-[0.875rem] font-[600]">{title}</h2>
      {children}
    </section>
  );
}

