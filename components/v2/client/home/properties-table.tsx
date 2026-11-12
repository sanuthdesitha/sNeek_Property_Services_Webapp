"use client";

/**
 * "Your properties" on the desktop dashboard: one row per home answering "how
 * is each home". Values arrive as display text from the server, already
 * filtered by visibility; this component only sorts.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { EBadge } from "@/components/v2/ui/primitives";

export type PropertyTableTone = "neutral" | "success" | "warning" | "info" | "danger";

export interface PropertyTableCell {
  text: string;
  /** Sort key; empty sorts last. */
  sort: string;
  badge?: { label: string; tone: PropertyTableTone };
  href?: string;
}

export interface PropertyTableRow {
  id: string;
  name: string;
  suburb: string;
  cells: Record<PropertyColumnKey, PropertyTableCell | null>;
}

export type PropertyColumnKey = "next" | "report" | "stock" | "laundry" | "cleaner" | "open";

export interface PropertyColumn {
  key: PropertyColumnKey;
  label: string;
}

type SortKey = "name" | PropertyColumnKey;

export function PropertiesTable({ rows, columns }: { rows: PropertyTableRow[]; columns: PropertyColumn[] }) {
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const sorted = React.useMemo(() => {
    const value = (row: PropertyTableRow) => (sort.key === "name" ? row.name.toLowerCase() : row.cells[sort.key]?.sort ?? "");
    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (!left !== !right) return left ? -1 : 1;
      return left.localeCompare(right) * sort.dir || a.name.localeCompare(b.name);
    });
  }, [rows, sort]);
  const toggle = (key: SortKey) => setSort((current) => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }));
  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th key={key} scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2 text-left font-[550]">
        <button type="button" onClick={() => toggle(key)} className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-[0.75rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))] focus-visible:outline focus-visible:outline-2">
          {label}
          {active ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : null}
        </button>
      </th>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-[0.8125rem]">
        <thead className="border-b border-[hsl(var(--e-border))]">
          <tr>
            {header("name", "Property")}
            {columns.map((column) => header(column.key, column.label))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--e-border))]">
          {sorted.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-2.5 align-top">
                <Link href={`/v2/client/properties/${row.id}`} className="font-semibold hover:underline">{row.name}</Link>
                {row.suburb ? <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.suburb}</div> : null}
              </td>
              {columns.map((column) => {
                const cell = row.cells[column.key];
                return (
                  <td key={column.key} className="px-3 py-2.5 align-top e-tnum">
                    {!cell ? <span className="text-[hsl(var(--e-muted-foreground))]">Not shared</span> : (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {cell.href ? <Link href={cell.href} className="hover:underline">{cell.text}</Link> : cell.text ? <span>{cell.text}</span> : null}
                        {cell.badge ? <EBadge tone={cell.badge.tone} soft>{cell.badge.label}</EBadge> : null}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
