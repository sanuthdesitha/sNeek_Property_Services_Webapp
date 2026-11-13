"use client";

/**
 * Cleaners tab on a phone (board "M-PeopleQuality", 2026-11). Rendered only
 * below 640px (the tab gates on useIsPhone); from 640px up the sortable table
 * with expandable rows is unchanged.
 *
 * - The list: the same server sort as the table (one "Sort by" select and a
 *   direction button, the EDataTable phone bar), then one card per cleaner
 *   with cleans, score, issues, open fixes, false confirmations and streak,
 *   and the row's one visible action plus its "⋯" menu.
 * - Tapping a cleaner opens its screen: the very same CleanerExpanded the
 *   table expands (rating mix, by category, open issues with Mark fixed,
 *   Propose deduction and the false confirmation decision), with the row's
 *   actions (Start coaching, Review / Propose bonus) docked at the bottom.
 */
import * as React from "react";
import { ChevronRight } from "lucide-react";
import { ECard } from "@/components/v2/ui/primitives";
import { PhoneTableBar } from "@/components/v2/ui/data-table-phone";
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { PhoneBackBar } from "@/components/v2/admin/phone-back-bar";
import type { CleanerSort, IssueListFilters, QualityTab } from "@/lib/quality/types";
import type { CleanerRow, HubContext } from "./hub-types";
import { FalseConfirmationCell, IssueSeverityPills, OpenFixesCell, ScoreCell, StreakCell } from "./cleaners-cells";
import { CleanerExpanded, type OpenIssueRequest } from "./cleaner-expanded";
import type { CleanerRowActionKey, CleanerRowActions } from "./cleaner-row-actions";

/** The table's sortable columns, in table order, as the phone sort select's options. */
const SORT_OPTIONS: ReadonlyArray<{ key: CleanerSort; label: string }> = [
  { key: "cleaner", label: "Cleaner" },
  { key: "cleans", label: "Cleans" },
  { key: "score", label: "Score" },
  { key: "issues", label: "Issues" },
  { key: "topCategory", label: "Top category" },
  { key: "openFixes", label: "Open fixes" },
  { key: "falseConfirmations", label: "False confirmations" },
  { key: "streak", label: "Streak" },
];

const SORT_COLUMNS: Array<EDataColumn<CleanerRow, CleanerSort>> = SORT_OPTIONS.map((option) => ({
  key: option.key,
  header: option.label,
  sortKey: option.key,
  firstDir: option.key === "cleaner" || option.key === "topCategory" ? "asc" : "desc",
  cell: () => null,
}));

const MUTED = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

export type CleanerActionsSlot = (row: CleanerRow, actions: CleanerRowActions) => React.ReactNode;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-semibold text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem]">{children}</dd>
    </div>
  );
}

function CleanerCard({ row, actions, renderActions, onOpen }: { row: CleanerRow; actions: CleanerRowActions; renderActions: CleanerActionsSlot; onOpen: () => void }) {
  return (
    <li className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3.5 py-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${row.name}`}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--e-radius-sm)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        <span className="min-w-0">
          <span className="block truncate text-[0.9375rem] font-[650]">{row.name}</span>
          <span className={MUTED}>
            {`${row.cleans} clean${row.cleans === 1 ? "" : "s"} · score `}
            <ScoreCell row={row} />
            {row.active ? "" : " · Not an active cleaner"}
          </span>
        </span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
      </button>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        <Fact label="Issues"><IssueSeverityPills row={row} /></Fact>
        <Fact label="Open fixes"><OpenFixesCell row={row} /></Fact>
        <Fact label="False confirmations"><FalseConfirmationCell row={row} /></Fact>
        <Fact label="Streak"><StreakCell row={row} /></Fact>
      </dl>
      {actions.primary ? <div className="mt-2.5 flex justify-end">{renderActions(row, actions)}</div> : null}
    </li>
  );
}

export function CleanersPhoneList({
  rows,
  sort,
  dir,
  openId,
  periodText,
  apiQuery,
  context,
  labelFor,
  refreshToken,
  hrefForTab,
  actionsFor,
  renderActions,
  onSort,
  onOpen,
  onOpenIssue,
  onChanged,
  state,
}: {
  rows: CleanerRow[];
  sort: CleanerSort;
  dir: "asc" | "desc";
  /** The cleaner whose screen is open (the table's expanded row). */
  openId: string | null;
  periodText: string | null;
  apiQuery: string;
  context: HubContext;
  labelFor: (key: string) => string;
  refreshToken: number;
  hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string;
  actionsFor: (row: CleanerRow) => CleanerRowActions;
  renderActions: CleanerActionsSlot;
  onSort: (sort: string, dir: "asc" | "desc") => void;
  onOpen: (cleanerId: string | null) => void;
  onOpenIssue: (request: OpenIssueRequest) => void;
  onChanged: () => void;
  /** Loading, error and empty states (the table's TableState around the list). */
  state: (content: React.ReactNode) => React.ReactNode;
}) {
  const open = openId ? rows.find((row) => row.cleanerId === openId) ?? null : null;

  if (open) {
    const actions = actionsFor(open);
    const score = open.avgScore === null ? "no score" : `score ${Math.round(open.avgScore)}`;
    return (
      <section aria-label={`${open.name}, quality`} className="space-y-4" data-cleaner-screen={open.cleanerId}>
        <PhoneBackBar
          title={open.name}
          subtitle={[periodText, `${open.cleans} clean${open.cleans === 1 ? "" : "s"}`, score].filter(Boolean).join(" · ")}
          backLabel="Back to cleaners"
          onBack={() => onOpen(null)}
          headingLevel={3}
        />
        <CleanerExpanded
          row={open}
          apiQuery={apiQuery}
          context={context}
          labelFor={labelFor}
          issuesHref={hrefForTab("issues", { cleanerId: open.cleanerId })}
          refreshToken={refreshToken}
          onOpenIssue={onOpenIssue}
          onChanged={onChanged}
        />
        {actions.primary ? (
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-20 -mx-4 flex justify-end border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.97)] px-4 py-2.5 backdrop-blur">
            {renderActions(open, actions)}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <ECard className="overflow-hidden p-0">
      <PhoneTableBar
        columns={SORT_COLUMNS}
        sort={{ key: sort, dir }}
        onSortChange={(next) => onSort(next.key, next.dir)}
        label="Cleaners"
        selecting={false}
      />
      {state(
        <ul aria-label="Cleaners" className="flex flex-col gap-2 p-2">
          {rows.map((row) => (
            <CleanerCard key={row.cleanerId} row={row} actions={actionsFor(row)} renderActions={renderActions} onOpen={() => onOpen(row.cleanerId)} />
          ))}
        </ul>,
      )}
    </ECard>
  );
}

export type { CleanerRowActionKey };
