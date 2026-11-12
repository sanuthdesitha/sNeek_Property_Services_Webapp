"use client";

/**
 * The Suppliers table as drawn: Supplier (name and details), Type, Terms,
 * Portal logins, In progress, On time, Open, and the row's "⋯" menu. Headers
 * that sort are buttons with aria-sort; the table scrolls inside its own box.
 */
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { TYPE_LABELS, type DirectoryEntry, type DirectorySort } from "@/lib/suppliers/directory-view";

type Props = {
  entries: DirectoryEntry[];
  openKey: string | null;
  sort: DirectorySort;
  dir: "asc" | "desc";
  onSort: (sort: DirectorySort) => void;
  onOpen: (entry: DirectoryEntry) => void;
  menuFor: (entry: DirectoryEntry) => ERowMenuItem[];
};

function SortHeader({ id, label, sort, dir, onSort, align = "left" }: { id: DirectorySort; label: string; sort: DirectorySort; dir: "asc" | "desc"; onSort: (sort: DirectorySort) => void; align?: "left" | "right" }) {
  const active = sort === id;
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 font-[550] ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" className="inline-flex min-h-8 items-center gap-1 hover:underline" onClick={() => onSort(id)}>
        {label}{active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export function SupplierTable({ entries, openKey, sort, dir, onSort, onOpen, menuFor }: Props) {
  return (
    <div className="overflow-x-auto" role="region" aria-label="Suppliers" tabIndex={0}>
      <table className="w-full min-w-[760px] text-[0.8125rem]">
        <thead className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <tr className="border-b border-[hsl(var(--e-border))]">
            <SortHeader id="name" label="Supplier" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader id="type" label="Type" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className="px-3 py-2 text-left font-[550]">Terms</th>
            <SortHeader id="logins" label="Portal logins" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader id="progress" label="In progress" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader id="ontime" label="On time" sort={sort} dir={dir} onSort={onSort} align="right" />
            <th scope="col" className="px-3 py-2"><span className="sr-only">Open</span></th>
            <th scope="col" className="w-[34px] px-1 py-2"><span className="sr-only">More</span></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const selected = entry.key === openKey;
            return (
              <tr key={entry.key} className={`border-b border-[hsl(var(--e-border))] align-top ${selected ? "bg-[hsl(var(--e-primary)/0.06)]" : ""} ${entry.active ? "" : "opacity-60"}`}>
                <td className="px-3 py-2.5">
                  <b className="font-[600] text-[hsl(var(--e-foreground))]">{entry.name}</b>
                  <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{entry.subtitle}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">{entry.types.map((type) => (type === "LAUNDRY" ? <EPill key={type} tone="info">{TYPE_LABELS[type]}</EPill> : <span key={type}>{TYPE_LABELS[type]}</span>))}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-[0.75rem]">{entry.terms}</td>
                <td className={`whitespace-nowrap px-3 py-2.5 ${entry.loginCount ? "" : "text-[hsl(var(--e-muted-foreground))]"}`}>{entry.loginsLabel}</td>
                <td className={`whitespace-nowrap px-3 py-2.5 ${entry.progressCount ? "" : "text-[hsl(var(--e-muted-foreground))]"}`}>
                  {entry.progressLabel} {entry.lateCount ? <EPill tone="warn">{entry.lateCount} late</EPill> : null}
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${entry.onTimePct == null ? "text-[hsl(var(--e-muted-foreground))]" : ""}`}>{entry.onTimePct == null ? "–" : `${entry.onTimePct}%`}</td>
                <td className="px-3 py-2.5"><EButton size="sm" variant={selected ? "primary" : "outline"} onClick={() => onOpen(entry)} aria-label={`Open ${entry.name}`}>Open</EButton></td>
                <td className="px-1 py-2.5"><ERowMenu label={`More for ${entry.name}`} items={menuFor(entry)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
