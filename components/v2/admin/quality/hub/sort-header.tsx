"use client";

/**
 * A sortable column header for the hub's own tables (the Cleaners table needs
 * expandable rows, which EDataTable does not draw). Same contract as
 * EDataTable: a real button, aria-sort on the <th>, the server sorts.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const TH_CLASS =
  "whitespace-nowrap bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.6875rem] font-semibold text-[hsl(var(--e-muted-foreground))]";

export function SortHeader<T extends string>({
  label,
  sortKey,
  active,
  dir,
  firstDir = "asc",
  align = "left",
  onSort,
}: {
  label: string;
  sortKey: T;
  active: T;
  dir: "asc" | "desc";
  firstDir?: "asc" | "desc";
  align?: "left" | "right";
  onSort: (key: T, dir: "asc" | "desc") => void;
}) {
  const isActive = sortKey === active;
  const next = isActive ? (dir === "asc" ? "desc" : "asc") : firstDir;
  return (
    <th scope="col" aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn(TH_CLASS, align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(sortKey, next)}
        className={cn(
          "inline-flex min-h-[1.75rem] items-center gap-1 rounded-[var(--e-radius-sm)] hover:text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
          isActive && "text-[hsl(var(--e-primary))]",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {isActive ? dir === "asc" ? <ArrowUp aria-hidden className="h-3 w-3" /> : <ArrowDown aria-hidden className="h-3 w-3" /> : <ArrowUpDown aria-hidden className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}
