"use client";

/**
 * People › Clients columns as drawn: Client, Properties, Logins, Invoices
 * open, Owing (with an Overdue badge), Last clean, Status; "Paid this month"
 * is offered in Columns (owner decision 2026-11-12). Money columns appear only
 * when the server sent them.
 */
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { E_CHIP_CLASS } from "@/components/v2/ui/filter-chips";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { DASH, formatMoney } from "@/components/v2/admin/accounts/hub/account-display";
import type { ClientDirectoryRow, ClientDirectorySort, ClientDirectoryVisibility } from "@/lib/people/clients/types";
import { formatCalendarDay } from "../format";

export const CLIENT_OPTIONAL_COLUMNS = ["properties", "logins", "invoicesOpen", "owing", "paidThisMonth", "lastClean", "status"] as const;
export type ClientOptionalColumn = (typeof CLIENT_OPTIONAL_COLUMNS)[number];
export type ClientColumnPrefs = Record<ClientOptionalColumn, boolean>;
export const DEFAULT_CLIENT_COLUMNS: ClientColumnPrefs = { properties: true, logins: true, invoicesOpen: true, owing: true, paidThisMonth: false, lastClean: true, status: true };

const LABEL: Record<ClientOptionalColumn, string> = {
  properties: "Properties",
  logins: "Logins",
  invoicesOpen: "Invoices open",
  owing: "Owing",
  paidThisMonth: "Paid this month",
  lastClean: "Last clean",
  status: "Status",
};

const MONEY_COLUMNS: ReadonlySet<ClientOptionalColumn> = new Set<ClientOptionalColumn>(["invoicesOpen", "owing", "paidThisMonth"]);

export function allowedClientColumns(visibility: ClientDirectoryVisibility): ClientOptionalColumn[] {
  return CLIENT_OPTIONAL_COLUMNS.filter((key) => visibility.money || !MONEY_COLUMNS.has(key));
}

function money(value: number | null | undefined) {
  return typeof value === "number" ? formatMoney(value) : <span className="text-[hsl(var(--e-muted-foreground))]">{DASH}</span>;
}

function Logins({ row }: { row: ClientDirectoryRow }) {
  if (row.logins === 0 && row.loginsInvited === 0) return <EPill tone="warn">No login</EPill>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="e-tnum">{row.logins}</span>
      {row.loginsInvited > 0 ? <span className="text-[hsl(var(--e-muted-foreground))]">+{row.loginsInvited} invited</span> : null}
      {row.assistants > 0 ? <EPill tone="neutral">+ VA</EPill> : null}
    </span>
  );
}

export type ClientRowActions = { onOpen: (row: ClientDirectoryRow) => void };

export function clientColumns(visibility: ClientDirectoryVisibility, prefs: ClientColumnPrefs, actions: ClientRowActions): Array<EDataColumn<ClientDirectoryRow, ClientDirectorySort>> {
  const allowed = new Set(allowedClientColumns(visibility));
  const show = (key: ClientOptionalColumn) => allowed.has(key) && prefs[key];
  const columns: Array<EDataColumn<ClientDirectoryRow, ClientDirectorySort> & { optional?: ClientOptionalColumn }> = [
    {
      key: "name",
      header: "Client",
      sortKey: "name",
      cell: (row) => (
        <div className="min-w-0">
          <button type="button" onClick={() => actions.onOpen(row)} className="block max-w-full truncate text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            {row.name}
          </button>
          <div className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.suburb ?? DASH}</div>
        </div>
      ),
    },
    { key: "properties", optional: "properties", header: "Properties", sortKey: "properties", align: "right", className: "e-tnum", cell: (row) => row.properties },
    { key: "logins", optional: "logins", header: "Logins", sortKey: "logins", cell: (row) => <Logins row={row} /> },
    { key: "invoicesOpen", optional: "invoicesOpen", header: "Invoices open", sortKey: "invoicesOpen", align: "right", className: "e-tnum", cell: (row) => row.invoicesOpen ?? DASH },
    {
      key: "owing",
      optional: "owing",
      header: "Owing",
      sortKey: "owing",
      firstDir: "desc",
      align: "right",
      className: "e-tnum",
      cell: (row) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          {money(row.owing)}
          {(row.overdueCount ?? 0) > 0 ? <EPill tone="bad">Overdue</EPill> : null}
        </span>
      ),
    },
    { key: "paidThisMonth", optional: "paidThisMonth", header: "Paid this month", align: "right", className: "e-tnum", cell: (row) => money(row.paidThisMonth) },
    { key: "lastClean", optional: "lastClean", header: "Last clean", sortKey: "lastClean", firstDir: "desc", cell: (row) => <span className={row.lastCleanDay ? undefined : "text-[hsl(var(--e-muted-foreground))]"}>{row.lastCleanDay ? formatCalendarDay(row.lastCleanDay) : "Not recorded"}</span> },
    { key: "status", optional: "status", header: "Status", sortKey: "status", cell: (row) => <EPill tone={row.isActive ? "ok" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</EPill> },
    {
      key: "menu",
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <ERowMenu
          label={`More actions for ${row.name}`}
          items={[
            { key: "panel", label: "Preview", onSelect: () => actions.onOpen(row) },
            { key: "open", label: "Open full client", href: `/v2/admin/clients/${row.id}` },
            { key: "update", label: "Send update", href: `/v2/admin/clients/${row.id}?tab=messages` },
            { key: "invoices", label: "Invoices", href: `/v2/admin/clients/${row.id}?tab=invoices` },
            { key: "access", label: "Portal access and assistants", href: `/v2/admin/clients/${row.id}?tab=portal` },
          ]}
        />
      ),
    },
  ];
  return columns.filter((column) => !column.optional || show(column.optional));
}

export function ClientColumnsMenu({ visibility, prefs, onChange }: { visibility: ClientDirectoryVisibility; prefs: ClientColumnPrefs; onChange: (next: ClientColumnPrefs) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={E_CHIP_CLASS}>Columns</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-skin="estate" aria-label="Columns" sideOffset={4} align="end" className="z-50 min-w-44 max-w-[calc(100vw-2rem)] rounded border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1 text-[hsl(var(--e-foreground))] shadow-lg">
          {allowedClientColumns(visibility).map((key) => (
            <Menu.CheckboxItem
              key={key}
              checked={prefs[key]}
              onCheckedChange={(checked) => onChange({ ...prefs, [key]: checked === true })}
              onSelect={(event) => event.preventDefault()}
              className="relative flex min-h-10 cursor-default select-none items-center rounded py-2 pl-8 pr-3 text-sm outline-none focus:bg-[hsl(var(--e-muted))]"
            >
              <Menu.ItemIndicator className="absolute left-2"><Check className="h-4 w-4" /></Menu.ItemIndicator>
              {LABEL[key]}
            </Menu.CheckboxItem>
          ))}
          <Menu.Separator className="my-1 h-px bg-[hsl(var(--e-border))]" />
          <Menu.Item onSelect={() => onChange({ ...DEFAULT_CLIENT_COLUMNS })} className="min-h-10 cursor-default rounded px-3 py-2 text-sm outline-none focus:bg-[hsl(var(--e-muted))]">Reset columns</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
