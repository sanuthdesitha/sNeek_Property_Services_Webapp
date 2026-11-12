"use client";

/**
 * The Accounts page as drawn: header with a real summary line, Export and
 * Invite person; role tabs with counts; filters; one table with server paging
 * and sorting; a bulk bar; the person panel on `?open=`.
 *
 * The Assistants tab keeps the VA directory and the client-scoped VA team
 * manager as they were (a VA login only means something with its team).
 * Birthdays stay on Everyone and Office, in a disclosure under the table.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import type { AccountBulkResponse } from "@/lib/accounts/bulk-types";
import type { AccountRow } from "@/lib/accounts/list/types";
import { EstateBirthdaysCard, type EstateBirthdayRow } from "@/components/v2/admin/accounts/birthdays-card";
import { EstateVaDirectory } from "@/components/v2/admin/accounts/va-directory";
import { EstateVaManager, type EstateVaClientOption } from "@/components/v2/admin/accounts/va-manager";
import { PersonPanel } from "../person/person-panel";
import { accountColumns, DEFAULT_COLUMN_PREFS, type ColumnPrefs } from "./accounts-columns";
import { AccountsBulk } from "./accounts-bulk";
import { AccountsFilters } from "./accounts-filters";
import { AccountsTabs } from "./accounts-tabs";
import { listQueryString, useAccountsView, type AccountsView } from "./accounts-url";
import { InvitePersonDialog } from "./invite-person-dialog";
import { CREATE_ROLE_FOR_TAB } from "./managed-roles";
import { ACCOUNTS_PAGE_SIZE, useAccountsList } from "./use-accounts-list";

export type AccountsHubCapabilities = { isAdmin: boolean; canWriteNotes: boolean; canMessageStaff?: boolean };

const COLUMNS_KEY = "sneek:accounts:columns:v1";
/** Until the first answer arrives, no optional figures are assumed visible. */
const NO_VISIBILITY = { pay: false, quality: false };

function readColumnPrefs(): ColumnPrefs {
  try {
    const raw = window.localStorage.getItem(COLUMNS_KEY);
    return raw ? { ...DEFAULT_COLUMN_PREFS, ...(JSON.parse(raw) as Partial<ColumnPrefs>) } : DEFAULT_COLUMN_PREFS;
  } catch {
    return DEFAULT_COLUMN_PREFS;
  }
}

function summaryLine(summary: { people: number; invitesPending: number; documentsExpiring: number; documentsExpired: number; documentsMissing?: number } | undefined): string {
  if (!summary) return "Loading…";
  const parts = [
    `${summary.people} ${summary.people === 1 ? "person" : "people"}`,
    `${summary.invitesPending} ${summary.invitesPending === 1 ? "invite" : "invites"} not accepted`,
    `${summary.documentsExpiring} ${summary.documentsExpiring === 1 ? "document" : "documents"} expiring`,
  ];
  if (summary.documentsExpired > 0) parts.push(`${summary.documentsExpired} expired`);
  if (summary.documentsMissing) parts.push(`${summary.documentsMissing} missing documents`);
  return parts.join(" · ");
}

export function AccountsHub({
  initialView,
  capabilities,
  birthdays,
  vaClients,
}: {
  initialView: AccountsView;
  capabilities: AccountsHubCapabilities;
  birthdays: EstateBirthdayRow[];
  vaClients: EstateVaClientOption[];
}) {
  const [view, update] = useAccountsView(initialView);
  const list = useAccountsList(view);
  const [columns, setColumns] = useState<ColumnPrefs>(DEFAULT_COLUMN_PREFS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => setColumns(readColumnPrefs()), []);
  const listKey = listQueryString(view, ACCOUNTS_PAGE_SIZE);
  // A different list: the old selection no longer describes what is on screen.
  useEffect(() => setSelected(new Set()), [listKey]);

  function changeColumns(next: ColumnPrefs) {
    setColumns(next);
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      /* preference only */
    }
  }

  const data = list.data;
  const visibility = data?.columns ?? NO_VISIBILITY;
  const rows = data?.rows ?? [];
  const open = useCallback((row: AccountRow) => update({ open: row.id }), [update]);
  const tableColumns = useMemo(() => accountColumns(visibility, columns, open), [visibility, columns, open]);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const canBulk = capabilities.isAdmin || capabilities.canWriteNotes || Boolean(capabilities.canMessageStaff);
  const exportHref = `/api/admin/users/export?${listKey}`;

  function bulkFinished(response: AccountBulkResponse) {
    setSelected(new Set(response.results.filter((result) => result.outcome === "refused").map((result) => result.id)));
    list.reload();
  }

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="e-display-md">Accounts</h1>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{summaryLine(data?.summary)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EButton asChild variant="outline" size="sm">
              <a href={exportHref} download>Export</a>
            </EButton>
            {capabilities.isAdmin ? <EButton size="sm" variant="primary" onClick={() => setInviteOpen(true)}>Invite person</EButton> : null}
          </div>
        </header>

        <AccountsTabs active={view.tab} counts={data?.counts ?? null} onSelect={(tab) => update({ tab })} />

        {view.tab === "assistants" ? (
          <div className="flex flex-col gap-6">
            <EstateVaDirectory canManage={capabilities.isAdmin} />
            <EstateVaManager clients={vaClients} canManage={capabilities.isAdmin} />
          </div>
        ) : (
          <>
            <AccountsFilters view={view} onChange={update} visibility={visibility} columns={columns} onColumnsChange={changeColumns} />
            <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
              <EDataTable<AccountRow>
                label="People"
                columns={tableColumns}
                rows={rows}
                rowKey={(row) => row.id}
                sort={{ key: view.sort, dir: view.dir }}
                onSortChange={(next) => update({ sort: next.key as AccountsView["sort"], dir: next.dir })}
                selection={canBulk ? { selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name ?? row.email}`, disabled: bulkRunning } : undefined}
                loading={list.loading}
                error={list.error}
                onRetry={list.reload}
                emptyTitle="No people match"
                emptyDescription="Try another tab, or clear the search and filters."
                onRowClick={open}
                activeRowKey={view.open}
                minWidth="60rem"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {data ? <EPagination className="min-w-0 flex-1" page={data.page} pageSize={data.pageSize} total={data.total} noun="people" disabled={list.loading} onPageChange={(page) => update({ page })} /> : <span />}
              <EButton size="sm" variant="ghost" disabled={list.loading} onClick={list.reload}>Refresh</EButton>
            </div>
            {canBulk ? (
              <AccountsBulk
                selectedRows={selectedRows}
                canResend={capabilities.canWriteNotes}
                isAdmin={capabilities.isAdmin}
                canMessage={Boolean(capabilities.canMessageStaff)}
                onClear={() => setSelected(new Set())}
                onFinished={bulkFinished}
                onRunningChange={setBulkRunning}
              />
            ) : null}
            {(view.tab === "everyone" || view.tab === "office") && birthdays.length > 0 ? (
              <details className="rounded-[12px] border border-[hsl(var(--e-border))] px-4 py-3">
                <summary className="cursor-pointer text-[0.8125rem] font-[550]">Upcoming birthdays ({birthdays.length})</summary>
                <div className="mt-3"><EstateBirthdaysCard birthdays={birthdays} /></div>
              </details>
            ) : null}
          </>
        )}
      </div>

      {view.open ? <PersonPanel userId={view.open} onClose={() => update({ open: null })} onListChanged={list.reload} /> : null}

      {capabilities.isAdmin ? (
        <InvitePersonDialog open={inviteOpen} defaultRole={CREATE_ROLE_FOR_TAB[view.tab]} onClose={() => setInviteOpen(false)} onCreated={list.reload} />
      ) : null}
    </div>
  );
}
