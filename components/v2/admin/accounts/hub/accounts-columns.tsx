"use client";

/**
 * The Accounts table's columns, as drawn: Name, Role, Status, Rate, Jobs 30 d,
 * QA 30 d, Documents, Last seen. A column the viewer may not see (the server
 * did not send it) is never offered; the rest can be hidden from Columns.
 */
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { E_CHIP_CLASS } from "@/components/v2/ui/filter-chips";
import type { AccountListVisibility, AccountRow, AccountSort } from "@/lib/accounts/list/types";
import { Avatar, DASH, DocumentsPill, RoleCell, StatusPill, formatLastSeen, formatMoney, formatRate } from "./account-display";

export const OPTIONAL_COLUMNS = ["role", "status", "jobsWeek", "rate", "owed", "jobs30", "qa30", "documents", "lastSeen"] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
export type ColumnPrefs = Record<OptionalColumn, boolean>;
export const DEFAULT_COLUMN_PREFS: ColumnPrefs = { role: true, status: true, jobsWeek: true, rate: true, owed: true, jobs30: true, qa30: true, documents: true, lastSeen: true };

const COLUMN_LABEL: Record<OptionalColumn, string> = {
  role: "Role",
  status: "Status",
  jobsWeek: "Jobs this week",
  rate: "Rate",
  owed: "Owed",
  jobs30: "Jobs, 30 d",
  qa30: "QA, 30 d",
  documents: "Documents",
  lastSeen: "Last seen",
};

/** Columns this viewer may have at all. */
export function allowedColumns(visibility: AccountListVisibility): OptionalColumn[] {
  return OPTIONAL_COLUMNS.filter((key) => {
    if (key === "rate" || key === "owed") return visibility.pay;
    if (key === "jobs30" || key === "qa30") return visibility.quality;
    return true;
  });
}

function figure(value: number | null | undefined, digits = 0) {
  return typeof value === "number" ? value.toFixed(digits) : <span className="text-[hsl(var(--e-muted-foreground))]">{DASH}</span>;
}

export function accountColumns(
  visibility: AccountListVisibility,
  prefs: ColumnPrefs,
  onOpen: (row: AccountRow) => void,
): Array<EDataColumn<AccountRow, AccountSort>> {
  const allowed = new Set(allowedColumns(visibility));
  const show = (key: OptionalColumn) => allowed.has(key) && prefs[key];
  const columns: Array<EDataColumn<AccountRow, AccountSort> & { optional?: OptionalColumn }> = [
    {
      key: "name",
      header: "Name",
      sortKey: "name",
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={row.name} email={row.email} />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="block max-w-full truncate text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
            >
              {row.name ?? "Unnamed"}
            </button>
            <div className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.email}</div>
          </div>
        </div>
      ),
    },
    { key: "role", optional: "role", header: "Role", sortKey: "role", cell: (row) => <RoleCell role={row.role} extraRoles={row.extraRoles} /> },
    { key: "status", optional: "status", header: "Status", sortKey: "status", cell: (row) => <StatusPill status={row.status} inviteAgeDays={row.inviteAgeDays} /> },
    { key: "jobsWeek", optional: "jobsWeek", header: "Jobs this week", sortKey: "jobsWeek", firstDir: "desc", align: "right", className: "e-tnum", cell: (row) => row.jobsWeek },
    {
      key: "rate",
      optional: "rate",
      header: "Rate",
      sortKey: "rate",
      align: "right",
      className: "e-tnum",
      cell: (row) => formatRate(row.rate) ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not set</span>,
    },
    {
      key: "owed",
      optional: "owed",
      header: "Owed",
      sortKey: "owed",
      firstDir: "desc",
      align: "right",
      className: "e-tnum",
      cell: (row) => (typeof row.owed === "number" ? formatMoney(row.owed) : <span className="text-[hsl(var(--e-muted-foreground))]">{DASH}</span>),
    },
    { key: "jobs30", optional: "jobs30", header: "Jobs, 30 d", sortKey: "jobs30", firstDir: "desc", align: "right", className: "e-tnum", cell: (row) => figure(row.jobs30) },
    { key: "qa30", optional: "qa30", header: "QA, 30 d", sortKey: "qa30", firstDir: "desc", align: "right", className: "e-tnum", cell: (row) => figure(row.qa30) },
    { key: "documents", optional: "documents", header: "Documents", sortKey: "documents", cell: (row) => <DocumentsPill state={row.documents} /> },
    {
      key: "lastSeen",
      optional: "lastSeen",
      header: "Last seen",
      sortKey: "lastSeen",
      firstDir: "desc",
      cell: (row) => <span className="text-[hsl(var(--e-muted-foreground))]">{formatLastSeen(row.lastSeenAt, undefined, { invited: row.status === "INVITED" })}</span>,
    },
  ];
  return columns.filter((column) => !column.optional || show(column.optional));
}

export function ColumnsMenu({ visibility, prefs, onChange }: { visibility: AccountListVisibility; prefs: ColumnPrefs; onChange: (next: ColumnPrefs) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={E_CHIP_CLASS}>Columns</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          data-skin="estate"
          aria-label="Columns"
          sideOffset={4}
          align="end"
          className="z-50 min-w-44 max-w-[calc(100vw-2rem)] rounded border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1 text-[hsl(var(--e-foreground))] shadow-lg"
        >
          {allowedColumns(visibility).map((key) => (
            <Menu.CheckboxItem
              key={key}
              checked={prefs[key]}
              onCheckedChange={(checked) => onChange({ ...prefs, [key]: checked === true })}
              onSelect={(event) => event.preventDefault()}
              className="relative flex min-h-10 cursor-default select-none items-center rounded py-2 pl-8 pr-3 text-sm outline-none focus:bg-[hsl(var(--e-muted))]"
            >
              <Menu.ItemIndicator className="absolute left-2">
                <Check className="h-4 w-4" />
              </Menu.ItemIndicator>
              {COLUMN_LABEL[key]}
            </Menu.CheckboxItem>
          ))}
          <Menu.Separator className="my-1 h-px bg-[hsl(var(--e-border))]" />
          <Menu.Item onSelect={() => onChange({ ...DEFAULT_COLUMN_PREFS })} className="min-h-10 cursor-default rounded px-3 py-2 text-sm outline-none focus:bg-[hsl(var(--e-muted))]">
            Show all columns
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
