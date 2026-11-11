"use client";

/**
 * Cleaners tab, as drawn: a sortable table with an 8-week score sparkline and
 * an expandable row per cleaner (open issues with their actions, by-category
 * breakdown, "Open all N in Issues"). One action per row: "Start coaching"
 * when a recurring-issue pattern suggests it and no coaching is open, else
 * "Review bonus" when the nightly job has proposed a bonus that awaits a
 * decision. Rows are sorted on the server.
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ECard, EButton } from "@/components/v2/ui/primitives";
import { CLEANER_SORTS, type CleanerSort, type IssueListFilters, type QualityTab } from "@/lib/quality/types";
import type { CleanerRow, HubContext } from "./hub-types";
import { isCleaners } from "./hub-types";
import { useQualityRead, useReloadOn } from "./use-quality-read";
import { Sparkline } from "./sparkline";
import { SortHeader, TH_CLASS } from "./sort-header";
import { FalseConfirmationCell, IssueSeverityPills, NoneText, OpenFixesCell, ScoreCell, StreakCell } from "./cleaners-cells";
import { CleanerExpanded, type OpenIssueRequest } from "./cleaner-expanded";
import { CoachingDialog } from "./coaching-dialog";
import { BonusDialog } from "./bonus-dialog";
import { TableState } from "./table-state";

const FIRST_DIR: Partial<Record<CleanerSort, "asc" | "desc">> = { cleaner: "asc", topCategory: "asc" };

type Dialog = { kind: "coaching" | "bonus"; row: CleanerRow } | null;

export function CleanersTab({
  apiQuery,
  sort,
  dir,
  context,
  labelFor,
  refreshToken,
  hrefForTab,
  onSort,
  onOpenIssue,
  onChanged,
}: {
  apiQuery: string;
  sort: string;
  dir: "asc" | "desc" | "";
  context: HubContext;
  labelFor: (key: string) => string;
  refreshToken: number;
  hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string;
  onSort: (sort: string, dir: "asc" | "desc") => void;
  onOpenIssue: (request: OpenIssueRequest) => void;
  onChanged: () => void;
}) {
  const activeSort: CleanerSort = (CLEANER_SORTS as readonly string[]).includes(sort) ? (sort as CleanerSort) : "score";
  const activeDir = dir || "desc";
  const params = new URLSearchParams(apiQuery);
  params.set("sort", activeSort);
  params.set("dir", activeDir);
  const read = useQualityRead(`/api/admin/quality/cleaners?${params.toString()}`, isCleaners, "Cleaner accountability could not be loaded.");
  useReloadOn(refreshToken, read.reload);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<Dialog>(null);

  // A different period or filter set is a different scope: collapse.
  React.useEffect(() => setExpanded(null), [apiQuery]);

  const rows = read.data?.rows ?? [];
  const header = (key: CleanerSort, label: string, align: "left" | "right" = "left") => (
    <SortHeader label={label} sortKey={key} active={activeSort} dir={activeDir} firstDir={FIRST_DIR[key] ?? "desc"} align={align} onSort={onSort} />
  );

  return (
    <div className="space-y-2">
      <ECard className="overflow-hidden p-0">
        <TableState loading={read.loading} error={read.error} hasRows={rows.length > 0} hasData={Boolean(read.data)} onRetry={read.reload} emptyTitle="No cleaners match" emptyDescription="Change the period or filters.">
          <div role="region" aria-label="Cleaners" tabIndex={0} className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            <table className="w-full min-w-[68rem] text-[0.8125rem]" aria-busy={read.loading || undefined}>
              <caption className="sr-only">Cleaners</caption>
              <thead>
                <tr className="border-b border-[hsl(var(--e-border))]">
                  {header("cleaner", "Cleaner")}
                  {header("cleans", "Cleans", "right")}
                  {header("score", "Score", "right")}
                  <th scope="col" className={TH_CLASS}>Trend, 8 weeks</th>
                  {header("issues", "Issues")}
                  {header("topCategory", "Top category")}
                  {header("openFixes", "Open fixes")}
                  {header("falseConfirmations", "False confirmations")}
                  {header("streak", "Streak")}
                  <th scope="col" className={TH_CLASS}><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--e-border))]">
                {rows.map((row) => {
                  const open = expanded === row.cleanerId;
                  const panelId = `cleaner-${row.cleanerId}`;
                  return (
                    <React.Fragment key={row.cleanerId}>
                      <tr className={cn(open && "bg-[hsl(var(--e-primary-soft))]")}>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={panelId}
                            onClick={() => setExpanded(open ? null : row.cleanerId)}
                            className="inline-flex items-center gap-1 rounded-[var(--e-radius-sm)] text-left font-[650] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
                          >
                            {row.name}
                            {open ? <ChevronDown aria-hidden className="h-3.5 w-3.5 text-[hsl(var(--e-muted-foreground))]" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5 text-[hsl(var(--e-muted-foreground))]" />}
                          </button>
                          {!row.active ? <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Not an active cleaner</span> : null}
                        </td>
                        <td className="px-3 py-2.5 text-right e-tnum">{row.cleans}</td>
                        <td className="px-3 py-2.5 text-right"><ScoreCell row={row} /></td>
                        <td className="px-3 py-2.5"><Sparkline points={row.trend} name={row.name} /></td>
                        <td className="px-3 py-2.5"><IssueSeverityPills row={row} /></td>
                        <td className="px-3 py-2.5">{row.topCategory ? row.topCategory.label : <NoneText />}</td>
                        <td className="px-3 py-2.5"><OpenFixesCell row={row} /></td>
                        <td className="px-3 py-2.5"><FalseConfirmationCell row={row} /></td>
                        <td className="px-3 py-2.5"><StreakCell row={row} /></td>
                        <td className="px-3 py-2.5 text-right">
                          {context.canManage && row.action === "start-coaching" ? (
                            <EButton size="sm" className="h-7 px-2.5 text-[0.75rem]" onClick={() => setDialog({ kind: "coaching", row })}>Start coaching</EButton>
                          ) : null}
                          {(context.canDecideBonus ?? context.canManage) && row.action === "review-bonus" ? (
                            <EButton size="sm" variant="outline" className="h-7 px-2.5 text-[0.75rem]" onClick={() => setDialog({ kind: "bonus", row })}>Review bonus</EButton>
                          ) : null}
                        </td>
                      </tr>
                      {open ? (
                        <tr id={panelId}>
                          <td colSpan={10} className="bg-[hsl(var(--e-background))] px-4 py-3">
                            <CleanerExpanded
                              row={row}
                              apiQuery={apiQuery}
                              context={context}
                              labelFor={labelFor}
                              issuesHref={hrefForTab("issues", { cleanerId: row.cleanerId })}
                              refreshToken={refreshToken}
                              onOpenIssue={onOpenIssue}
                              onChanged={onChanged}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TableState>
      </ECard>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Cleans are submitted cleans scheduled in the period; score is the authoritative review (QA, then admin, then automatic).
        Trend shows the 8 Sydney weeks to the end of the period. Streak counts consecutive qualifying cleans, all time.
      </p>
      {dialog?.kind === "coaching" ? (
        <CoachingDialog key={dialog.row.cleanerId} row={dialog.row} onClose={() => setDialog(null)} onCreated={() => { setDialog(null); onChanged(); }} />
      ) : null}
      {dialog?.kind === "bonus" ? (
        <BonusDialog key={dialog.row.cleanerId} row={dialog.row} timeZone={context.timeZone} onClose={() => setDialog(null)} onDecided={onChanged} />
      ) : null}
    </div>
  );
}
