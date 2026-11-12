"use client";

/**
 * People tabs that list LOGINS (Cleaners, Office and other staff, Laundry
 * partners, and the Everyone / Needs attention / Client logins chip views),
 * built from the Accounts list's own parts: server-paged list
 * (/api/admin/users?paginated=1), filters, Columns menu, bulk bar, the person
 * panel and the birthdays disclosure. Cleaners adds the Workforce and roster
 * figures and the links to Compliance, Coaching, Recognition, Roster and Home
 * addresses (People board).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import type { AccountBulkResponse } from "@/lib/accounts/bulk-types";
import type { AccountTab } from "@/lib/accounts/list/tabs";
import type { AccountRow } from "@/lib/accounts/list/types";
import type { CleanerFigures } from "@/lib/people/cleaner-figures";
import type { PeopleCounts } from "@/lib/people/counts";
import type { PeopleTab } from "@/lib/people/tabs";
import { EstateBirthdaysCard, type EstateBirthdayRow } from "@/components/v2/admin/accounts/birthdays-card";
import { PersonPanel } from "@/components/v2/admin/accounts/person/person-panel";
import { accountColumns, DEFAULT_COLUMN_PREFS, type ColumnPrefs } from "@/components/v2/admin/accounts/hub/accounts-columns";
import { AccountsBulk } from "@/components/v2/admin/accounts/hub/accounts-bulk";
import { AccountsFilters } from "@/components/v2/admin/accounts/hub/accounts-filters";
import { formatMoney } from "@/components/v2/admin/accounts/hub/account-display";
import { listQueryString, readAccountsView, useAccountsView, type AccountsView } from "@/components/v2/admin/accounts/hub/accounts-url";
import { ACCOUNTS_PAGE_SIZE, useAccountsList } from "@/components/v2/admin/accounts/hub/use-accounts-list";
import { FactStrip, type Fact } from "./fact-strip";
import type { PeopleCapabilities } from "./people-directory";

const COLUMNS_KEY = "sneek:people:columns:v1";
const NO_VISIBILITY = { pay: false, quality: false };

function readColumnPrefs(tab: PeopleTab): ColumnPrefs {
  try {
    const raw = window.localStorage.getItem(`${COLUMNS_KEY}:${tab}`);
    return raw ? { ...DEFAULT_COLUMN_PREFS, ...(JSON.parse(raw) as Partial<ColumnPrefs>) } : defaultPrefs(tab);
  } catch {
    return defaultPrefs(tab);
  }
}

/** Each tab keeps the columns drawn for it; the rest stay in Columns. */
function defaultPrefs(tab: PeopleTab): ColumnPrefs {
  if (tab === "cleaners") return { ...DEFAULT_COLUMN_PREFS, role: false, jobs30: false };
  if (tab === "office" || tab === "partners") return { ...DEFAULT_COLUMN_PREFS, jobsWeek: false, rate: false, owed: false, jobs30: false, qa30: false, documents: false };
  return DEFAULT_COLUMN_PREFS;
}

function cleanerFacts(figures: CleanerFigures): Fact[] {
  return [
    { key: "active", label: "Active cleaners", value: figures.activeCleaners },
    { key: "jobs", label: "Active jobs", value: figures.activeJobs },
    { key: "owed", label: "Owed (approved)", value: figures.owedApproved === null ? null : formatMoney(figures.owedApproved) },
    { key: "expired", label: "Docs expired", value: figures.docsExpired },
    { key: "expiring", label: "Expiring ≤14 d", value: figures.docsExpiring },
    { key: "review", label: "Pending review", value: figures.docsPendingReview },
    { key: "onboarding", label: "Onboarding done", value: figures.onboardingDonePercent === null ? null : `${figures.onboardingDonePercent}%` },
    { key: "kudos", label: "Kudos this month", value: figures.kudosThisMonth },
  ];
}

function ViewChips({ active, counts, onSelect }: { active: PeopleTab; counts: Partial<Record<AccountTab, number>> | null; onSelect: (tab: PeopleTab) => void }) {
  const chips: Array<{ tab: PeopleTab; label: string; count: number | undefined }> = [
    { tab: "everyone", label: "Everyone", count: counts?.everyone },
    { tab: "attention", label: "Needs attention", count: counts?.attention },
  ];
  if (active === "everyone" || active === "logins") chips.push({ tab: "logins", label: "Client logins", count: counts?.clients });
  return (
    <div role="group" aria-label="Views" className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button key={chip.tab} type="button" aria-pressed={active === chip.tab} onClick={() => onSelect(chip.tab)} className={cn(E_CHIP_CLASS, active === chip.tab && E_CHIP_ON_CLASS)}>
          {chip.label}
          {typeof chip.count === "number" ? <span className="e-tnum ml-1">{chip.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function CleanerLinks({ capabilities }: { capabilities: PeopleCapabilities }) {
  const links = [
    ...(capabilities.canSeeWorkforce
      ? [
          { href: "/v2/admin/workforce/compliance", label: "Compliance" },
          { href: "/v2/admin/workforce/coaching", label: "Coaching" },
          { href: "/v2/admin/workforce/recognition", label: "Recognition" },
          { href: "/v2/admin/workforce/roster", label: "Roster" },
        ]
      : []),
    ...(capabilities.canViewAddresses ? [{ href: "/v2/admin/cleaners/addresses", label: "Home addresses" }] : []),
  ];
  if (links.length === 0) return null;
  return (
    <nav aria-label="Cleaner pages" className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <EButton key={link.href} asChild size="sm" variant="ghost">
          <Link href={link.href}>{link.label}</Link>
        </EButton>
      ))}
    </nav>
  );
}

export function AccountListTab({
  peopleTab,
  listTab,
  initialSearch,
  capabilities,
  cleanerFigures,
  birthdays,
  onExportHref,
  onSelectView,
}: {
  peopleTab: PeopleTab;
  listTab: AccountTab;
  initialSearch: string;
  capabilities: PeopleCapabilities;
  counts: PeopleCounts;
  cleanerFigures: CleanerFigures;
  birthdays: EstateBirthdayRow[];
  onExportHref: (href: string | null) => void;
  onSelectView: (tab: PeopleTab) => void;
}) {
  const initialView = useMemo<AccountsView>(() => ({ ...readAccountsView(initialSearch), tab: listTab }), [initialSearch, listTab]);
  const [view, update] = useAccountsView(initialView, peopleTab);
  const list = useAccountsList(view);
  const [columns, setColumns] = useState<ColumnPrefs>(() => defaultPrefs(peopleTab));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => setColumns(readColumnPrefs(peopleTab)), [peopleTab]);
  const listKey = listQueryString(view, ACCOUNTS_PAGE_SIZE);
  useEffect(() => setSelected(new Set()), [listKey]);
  useEffect(() => onExportHref(`/api/admin/users/export?${listKey}`), [listKey, onExportHref]);

  function changeColumns(next: ColumnPrefs) {
    setColumns(next);
    try {
      window.localStorage.setItem(`${COLUMNS_KEY}:${peopleTab}`, JSON.stringify(next));
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
  const canBulk = capabilities.isAdmin || capabilities.canWriteNotes || capabilities.canMessageStaff;

  function bulkFinished(response: AccountBulkResponse) {
    setSelected(new Set(response.results.filter((result) => result.outcome === "refused").map((result) => result.id)));
    list.reload();
  }

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {peopleTab === "cleaners" ? (
          <>
            <FactStrip label="Cleaner figures" facts={cleanerFacts(cleanerFigures)} />
            <CleanerLinks capabilities={capabilities} />
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <ViewChips active={peopleTab} counts={data?.counts ?? null} onSelect={onSelectView} />
        </div>
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
            canMessage={capabilities.canMessageStaff}
            onClear={() => setSelected(new Set())}
            onFinished={bulkFinished}
            onRunningChange={setBulkRunning}
          />
        ) : null}
        {(peopleTab === "everyone" || peopleTab === "office") && birthdays.length > 0 ? (
          <details className="rounded-[12px] border border-[hsl(var(--e-border))] px-4 py-3">
            <summary className="cursor-pointer text-[0.8125rem] font-[550]">Upcoming birthdays ({birthdays.length})</summary>
            <div className="mt-3"><EstateBirthdaysCard birthdays={birthdays} /></div>
          </details>
        ) : null}
      </div>
      {view.open ? <PersonPanel userId={view.open} onClose={() => update({ open: null })} onListChanged={list.reload} /> : null}
    </div>
  );
}
