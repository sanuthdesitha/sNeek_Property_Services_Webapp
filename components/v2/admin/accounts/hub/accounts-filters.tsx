"use client";

/**
 * Filter row as drawn: search (name, email, phone), Active / Invited /
 * Disabled, Documents, a role filter on tabs that span roles, and Columns.
 * A status chip pressed again clears back to every status.
 */
import { useEffect, useState } from "react";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { roleFilterOptions } from "@/lib/accounts/list/tabs";
import type { AccountListVisibility, AccountStatusFilter } from "@/lib/accounts/list/types";
import type { AccountsView } from "./accounts-url";
import { ColumnsMenu, type ColumnPrefs } from "./accounts-columns";

const STATUS_CHIPS: Array<{ key: Exclude<AccountStatusFilter, "all">; label: string }> = [
  { key: "active", label: "Active" },
  { key: "invited", label: "Invited" },
  { key: "disabled", label: "Disabled" },
];
const SEARCH_DELAY_MS = 300;

export function AccountsFilters({
  view,
  onChange,
  visibility,
  columns,
  onColumnsChange,
}: {
  view: AccountsView;
  onChange: (patch: Partial<AccountsView>) => void;
  visibility: AccountListVisibility;
  columns: ColumnPrefs;
  onColumnsChange: (next: ColumnPrefs) => void;
}) {
  const [search, setSearch] = useState(view.q);
  useEffect(() => setSearch(view.q), [view.q]);
  useEffect(() => {
    if (search === view.q) return;
    const timer = window.setTimeout(() => onChange({ q: search }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, view.q, onChange]);

  const roles = roleFilterOptions(view.tab);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label="Search people"
        placeholder="Search name, email, phone"
        className="h-8 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] sm:w-[240px]"
      />
      <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1.5">
        {STATUS_CHIPS.map((chip) => {
          const pressed = view.status === chip.key;
          return (
            <button key={chip.key} type="button" aria-pressed={pressed} onClick={() => onChange({ status: pressed ? "all" : chip.key })} className={cn(E_CHIP_CLASS, pressed && E_CHIP_ON_CLASS)}>
              {chip.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={view.documents}
          title="Documents missing, expired or expiring"
          onClick={() => onChange({ documents: !view.documents })}
          className={cn(E_CHIP_CLASS, view.documents && E_CHIP_ON_CLASS)}
        >
          Documents
        </button>
        {visibility.pay ? (
          <button
            type="button"
            aria-pressed={view.noRate}
            title="No default pay rate set"
            onClick={() => onChange({ noRate: !view.noRate })}
            className={cn(E_CHIP_CLASS, view.noRate && E_CHIP_ON_CLASS)}
          >
            No pay rate
          </button>
        ) : null}
        {roles.length > 1 ? (
          <EFilterPopover label="Role" value={view.role ? ROLE_LABELS[view.role as Role] : null}>
            <div role="radiogroup" aria-label="Role" className="flex min-w-[12rem] flex-col gap-1 p-1">
              {[{ value: "", label: "All roles" }, ...roles.map((role) => ({ value: role as string, label: ROLE_LABELS[role] }))].map((option) => (
                <label key={option.value || "all"} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]">
                  <input type="radio" name="accounts-role" value={option.value} checked={view.role === option.value} onChange={() => onChange({ role: option.value })} />
                  {option.label}
                </label>
              ))}
            </div>
          </EFilterPopover>
        ) : null}
      </div>
      <span className="hidden flex-1 sm:block" />
      <ColumnsMenu visibility={visibility} prefs={columns} onChange={onColumnsChange} />
    </div>
  );
}
