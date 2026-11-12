"use client";

/**
 * The Quality hub (/v2/admin/quality): one period control and one filter row
 * shared by every tab, six stat cards, and the Review queue, Issues,
 * Cleaners, Inspectors, Categories and Coaching tabs. Everything lives in the
 * URL. QA inspectors get the Issues tab only, read-only.
 */
import * as React from "react";
import { Download } from "lucide-react";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { sharedFiltersOnly } from "@/lib/quality/filters";
import { QUALITY_TAB_LABEL, type IssueListFilters, type QualityTab } from "@/lib/quality/types";
import { IssueDetail } from "../issues/issue-detail";
import type { HubContext, QualityIssueRow } from "./hub-types";
import { isOptions, isSummary } from "./hub-types";
import { hubApiQuery, useHubState } from "./use-hub-state";
import { useQualityRead } from "./use-quality-read";
import { PeriodControl } from "./period-control";
import { QualityStatCards } from "./stat-cards";
import { QualityTabs } from "./hub-tabs";
import { SharedFilters } from "./shared-filters";
import { CleanersTab } from "./cleaners-tab";
import { IssuesTab } from "./issues-tab";
import { InspectorsTab } from "./inspectors-tab";
import { CategoriesTab } from "./categories-tab";
import { ReviewTab } from "./review-tab";
import { CoachingTab } from "./coaching-tab";
import type { OpenIssueRequest } from "./cleaner-expanded";
import { LaundryTeamSection } from "./laundry-team-section";

const MANAGER_TABS: readonly QualityTab[] = ["review", "issues", "cleaners", "inspectors", "categories", "coaching"];
const INSPECTOR_TABS: readonly QualityTab[] = ["issues"];
/** A manager whose packs refuse the coaching endpoints never gets a blank tab. */
const MANAGER_TABS_WITHOUT_COACHING: readonly QualityTab[] = MANAGER_TABS.filter((tab) => tab !== "coaching");

type OpenDetail = { issue: QualityIssueRow; action: "rectify" | "deduction" | null };

export function QualityHub({ context }: { context: HubContext }) {
  const coaching = context.coaching ?? { visible: true, canManage: context.canManage, fullPageLink: true };
  const tabs = context.inspectorView
    ? INSPECTOR_TABS
    : coaching.visible
      ? MANAGER_TABS
      : MANAGER_TABS_WITHOUT_COACHING;
  const defaultTab: QualityTab = context.inspectorView ? "issues" : "cleaners";
  const { state, update, hrefForTab } = useHubState(tabs, defaultTab);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [detail, setDetail] = React.useState<OpenDetail | null>(null);

  const sharedQuery = hubApiQuery({ period: state.period, filters: sharedFiltersOnly(state.filters) }).toString();
  const issueQuery = hubApiQuery({ period: state.period, filters: state.filters }).toString();
  const queueQuery = new URLSearchParams(
    Object.entries({ propertyId: state.filters.propertyId, q: state.filters.q.trim() }).filter(([, value]) => value),
  ).toString();

  const summary = useQualityRead(context.inspectorView ? null : `/api/admin/quality/summary?${sharedQuery}`, isSummary, "Figures could not be loaded.");
  const options = useQualityRead("/api/admin/quality/options", isOptions, "Filter options could not be loaded.");
  const labels = React.useMemo(() => new Map((options.data?.categories ?? []).map((option) => [option.id, option.label])), [options.data]);
  const labelFor = React.useCallback((key: string) => labels.get(key) ?? key, [labels]);

  const reloadSummary = summary.reload;
  const onChanged = React.useCallback(() => {
    setRefreshToken((value) => value + 1);
    reloadSummary();
  }, [reloadSummary]);

  // A different scope closes an open issue so it cannot act on stale context.
  React.useEffect(() => setDetail(null), [issueQuery, state.tab]);

  const onFilters = React.useCallback((patch: Partial<IssueListFilters>) => update({ filters: patch }), [update]);
  const onSort = React.useCallback((sort: string, dir: "asc" | "desc") => update({ sort, dir }), [update]);
  const onPage = React.useCallback((page: number) => update({ page }), [update]);
  const openIssue = React.useCallback((issue: QualityIssueRow) => setDetail({ issue, action: null }), []);
  const openIssueRequest = React.useCallback((request: OpenIssueRequest) => setDetail(request), []);

  const counts: Partial<Record<QualityTab, number>> = summary.data
    ? { review: summary.data.tabs.reviewQueue, issues: summary.data.tabs.issues, coaching: summary.data.tabs.coaching }
    : {};
  const exportParams = new URLSearchParams(issueQuery);

  return (
    <div className="space-y-4">
      <EPageHeader
        title="Quality"
        description="Review queue, issues, cleaner accountability and inspector performance in one place"
        actions={
          <>
            <PeriodControl period={state.period} onChange={(period) => update({ period })} />
            <EButton asChild size="sm" variant="outline">
              <a href={`/api/admin/quality/issues/export?${exportParams.toString()}`} download title="Download the issues for this period and these filters as CSV">
                <Download aria-hidden className="h-3.5 w-3.5" /> Export
              </a>
            </EButton>
          </>
        }
      />

      {context.inspectorView ? null : <QualityStatCards summary={summary.data} loading={summary.loading} error={summary.error} />}

      <QualityTabs tabs={tabs} active={state.tab} counts={counts} hrefFor={(tab) => hrefForTab(tab)} />

      <SharedFilters
        filters={state.filters}
        options={options.data}
        optionsError={options.error}
        searchLabel="Search cleaner, property or job"
        onChange={onFilters}
      />

      <div className="min-w-0">
        <h2 className="sr-only">{QUALITY_TAB_LABEL[state.tab]}</h2>
        {state.tab === "cleaners" ? (
          <CleanersTab
            apiQuery={sharedQuery}
            sort={state.sort}
            dir={state.dir}
            context={context}
            labelFor={labelFor}
            refreshToken={refreshToken}
            hrefForTab={hrefForTab}
            onSort={onSort}
            onOpenIssue={openIssueRequest}
            onChanged={onChanged}
          />
        ) : null}
        {state.tab === "issues" ? (
          <IssuesTab
            apiQuery={issueQuery}
            filters={state.filters}
            sort={state.sort}
            dir={state.dir}
            page={state.page}
            context={context}
            labelFor={labelFor}
            refreshToken={refreshToken}
            onFilters={onFilters}
            onSort={onSort}
            onPage={onPage}
            onOpenIssue={openIssue}
            onChanged={onChanged}
          />
        ) : null}
        {state.tab === "inspectors" ? (
          <InspectorsTab apiQuery={sharedQuery} sort={state.sort} dir={state.dir} refreshToken={refreshToken} hrefForTab={hrefForTab} onSort={onSort} />
        ) : null}
        {state.tab === "categories" ? (
          <CategoriesTab apiQuery={sharedQuery} sort={state.sort} dir={state.dir} refreshToken={refreshToken} hrefForTab={hrefForTab} onSort={onSort} />
        ) : null}
        {state.tab === "review" ? (
          <ReviewTab
            filterQuery={queueQuery}
            sort={state.sort}
            dir={state.dir}
            page={state.page}
            quickScoreTotal={summary.data?.tabs.quickScore ?? null}
            timeZone={context.timeZone}
            refreshToken={refreshToken}
            onSort={onSort}
            onPage={onPage}
            onChanged={onChanged}
          />
        ) : null}
        {state.tab === "coaching" && coaching.visible ? <CoachingTab canManage={coaching.canManage} fullPageLink={coaching.fullPageLink} /> : null}
      </div>

      {/* Restored for quality-pack viewers (parity audit 2026-11-12): the same
          figures as Laundry statistics, read through the quality pack. */}
      {context.inspectorView ? null : <LaundryTeamSection laundryStatsLink={context.laundryStatsLink ?? true} />}

      {detail ? (
        <IssueDetail
          key={`${detail.issue.id}:${detail.action ?? "view"}`}
          issue={detail.issue}
          categoryLabel={labelFor(detail.issue.category)}
          canManage={context.canManage}
          initialAction={detail.action}
          falseConfirmationDeduction={context.falseConfirmationDeduction}
          timeZone={context.timeZone}
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
