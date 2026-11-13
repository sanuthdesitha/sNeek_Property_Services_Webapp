"use client";

/**
 * ESTATE admin Laundry. Header with the day's real summary, Previous / Today /
 * Next day, Generate week and Add run; the tabs straight under the header, as
 * drawn: Pipeline (default), By property, Drivers live, Costs and invoices,
 * Suppliers, Statistics. The three stat tiles (captions state their scope) sit
 * at the top of Statistics and the Approvals link under the Pipeline, so the
 * lanes come first as in the design.
 *
 * Links keep working: `?tab=` accepts the new ids and the old ones (today,
 * completed, investigate, live, reports, suppliers); `?date=YYYY-MM-DD` (the
 * Calendar's laundry-run links) opens the Pipeline on that day; `?open=<taskId>`
 * opens a run's side panel; `?supplier=<laundry partner id>` (the Suppliers
 * list's "Laundry runs" link) opens the Pipeline filtered to that partner.
 * Polling runs only on Pipeline and Drivers live.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, PackageCheck, Shirt, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader, EStatCard } from "@/components/v2/ui/primitives";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { isDayKey } from "@/lib/calendar/range";
import { SYDNEY_TZ, addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { LAUNDRY_TABS, LAUNDRY_TAB_LABELS, resolveLaundryTab, type LaundryTab, type PipelineView } from "@/lib/laundry/pipeline";
import { LaundrySuppliers } from "./laundry-suppliers";
import { LaundryLive } from "./laundry-live";
import { LaundryReports } from "./laundry-reports";
import { LaundryNewRun } from "./laundry-new-run";
import { LaundryAddRun } from "./laundry-add-run";
import { LaundryInvestigation } from "./laundry-investigation";
import { LaundryStatistics } from "./laundry-statistics";
import { LaundryPipelineTab, NO_RUN_TOOLS, type RunTools } from "./laundry-pipeline-tab";
import { useLaundryPipeline, type PipelineData, type PipelineQuery } from "./use-laundry-pipeline";
import { useLaundryFeed } from "./use-laundry-feed";
import type { HistoryFilters } from "./laundry-history";

function daySummary(day: string, data: PipelineData | null): string {
  const label = formatInTimeZone(sydneyDayStart(day), SYDNEY_TZ, "EEE d MMM");
  if (!data || data.date !== day) return label;
  const when = day === data.today ? "today" : "that day";
  const { pickups, drops, exceptions } = data.summary;
  return `${label} · ${pickups} pickup${pickups === 1 ? "" : "s"} and ${drops} drop${drops === 1 ? "" : "s"} ${when} · ${exceptions} exception${exceptions === 1 ? "" : "s"}`;
}

function writeUrl(patch: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

export function LaundryWorkspace({ canReviewBags = false, timeZone = "Australia/Sydney", runTools = NO_RUN_TOOLS }: { canReviewBags?: boolean; timeZone?: string; runTools?: RunTools }) {
  const [tab, setTabState] = useRestorableState<LaundryTab>("laundry-workspace:tab", "pipeline");
  const [view, setView] = useRestorableState<PipelineView>("laundry-workspace:view", "board");
  const [exceptionsFirst, setExceptionsFirst] = useRestorableState("laundry-workspace:exceptions-first", true);
  const [reportTask, setReportTask] = useRestorableState<{ id: string; name: string } | null>("admin-laundry:report-task", null);
  const [history, setHistory] = useRestorableState<HistoryFilters>("laundry-workspace:history", {
    search: "",
    status: "all",
    show: "completed",
    start: addDaysToKey(sydneyTodayKey(), -14),
    end: addDaysToKey(sydneyTodayKey(), 14),
  });
  const [query, setQuery] = React.useState<PipelineQuery>(() => ({ date: sydneyTodayKey(), q: "", supplierId: "", driverId: "" }));
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState(false);

  // On arrival, an explicit link wins over the remembered tab: ?tab= (new or
  // old ids) and ?date= (Calendar links open the Pipeline on that day).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = resolveLaundryTab(params.get("tab"));
    const date = params.get("date");
    if (linked) {
      setTabState(linked.tab);
      if (linked.tab === "pipeline") setView(linked.view);
    } else {
      // A remembered old id (e.g. "today") still resolves.
      setTabState((current) => resolveLaundryTab(current)?.tab ?? "pipeline");
    }
    if (isDayKey(date)) {
      setTabState("pipeline");
      setView("board");
      setQuery((current) => ({ ...current, date }));
    }
    const supplierId = (params.get("supplier") ?? "").trim();
    if (supplierId && supplierId.length <= 64) {
      setTabState("pipeline");
      setView("board");
      setQuery((current) => ({ ...current, supplierId }));
    }
    // Only on arrival; later choices are the person's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = React.useCallback((next: LaundryTab) => {
    setTabState(next);
    writeUrl({ tab: next === "pipeline" ? null : next });
  }, [setTabState]);

  const setSaving = React.useCallback((id: string, saving: boolean) => {
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const pipeline = useLaundryPipeline(query, { live: tab === "pipeline" && view === "board", paused: savingIds.size > 0 || editing });
  const feedEnabled = tab === "property" || (tab === "pipeline" && view === "completed");
  const feed = useLaundryFeed({ start: history.start, end: history.end }, feedEnabled);
  const data = pipeline.data;

  const goToDay = (date: string) => {
    setQuery((current) => ({ ...current, date }));
    writeUrl({ date: date === sydneyTodayKey() ? null : date });
  };

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Laundry"
        description={daySummary(query.date, data)}
        actions={
          <>
            <EButton variant="outline" size="sm" aria-label="Previous day" onClick={() => goToDay(addDaysToKey(query.date, -1))}><ChevronLeft aria-hidden className="h-4 w-4" /></EButton>
            <EButton variant="outline" size="sm" onClick={() => goToDay(sydneyTodayKey())}>Today</EButton>
            <EButton variant="outline" size="sm" aria-label="Next day" onClick={() => goToDay(addDaysToKey(query.date, 1))}><ChevronRight aria-hidden className="h-4 w-4" /></EButton>
            <LaundryNewRun onApplied={pipeline.reload} />
            <LaundryAddRun onCreated={pipeline.reload} />
          </>
        }
      />

      <div className="-mx-1 overflow-x-auto px-1">
        <div role="tablist" aria-label="Laundry sections" className="inline-flex min-w-full gap-1 border-b border-[hsl(var(--e-border))]">
          {LAUNDRY_TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[0.8125rem] font-[550] transition-colors",
                tab === key ? "border-[hsl(var(--e-primary))] text-[hsl(var(--e-foreground))]" : "border-transparent text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
              )}
            >
              {LAUNDRY_TAB_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-label={LAUNDRY_TAB_LABELS[tab]}>
        {tab === "pipeline" ? (
          <LaundryPipelineTab
            runTools={{ ...runTools, timeZone }}
            pipeline={pipeline}
            query={query}
            onQuery={(patch) => setQuery((current) => ({ ...current, ...patch }))}
            exceptionsFirst={exceptionsFirst}
            onExceptionsFirst={setExceptionsFirst}
            view={view}
            onView={setView}
            feed={feed}
            history={history}
            onHistory={(patch) => setHistory((current) => ({ ...current, ...patch }))}
            savingIds={savingIds}
            setSaving={setSaving}
            onEditing={setEditing}
            onReport={(task) => {
              setReportTask({ id: task.id, name: task.property?.name ?? "Property" });
              setTab("costs");
            }}
          />
        ) : null}
        {tab === "pipeline" ? (
          <p className="mt-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Reschedule and skip requests are decided in{" "}
            <Link href="/v2/admin/approvals" className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
              Approvals{data ? ` (${data.approvalsFlagged} flagged run${data.approvalsFlagged === 1 ? "" : "s"})` : ""}
            </Link>
            .
          </p>
        ) : null}
        {tab === "property" ? <LaundryInvestigation initialTasks={feed.tasks.filter((task) => !task.voidedAt)} canReviewBags={canReviewBags} /> : null}
        {tab === "live" ? <LaundryLive timeZone={timeZone} /> : null}
        {tab === "costs" ? <LaundryReports key={reportTask?.id ?? "all"} task={reportTask} onClearTask={() => setReportTask(null)} /> : null}
        {tab === "suppliers" ? <LaundrySuppliers /> : null}
        {tab === "statistics" ? (
          <div className="space-y-4">
            <section aria-label="Today's laundry figures" className="grid gap-3 sm:grid-cols-3">
              <EStatCard label="Runs today" value={data ? String(data.tiles.runsToday) : "—"} delta="pickup or drop-off dated today (Sydney)" deltaTone="neutral" icon={<Shirt className="h-4 w-4" />} />
              <EStatCard label="In transit" value={data ? String(data.tiles.inTransit) : "—"} delta="picked up, not yet delivered (any date)" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
              <EStatCard label="Delivered today" value={data ? String(data.tiles.deliveredToday) : "—"} delta="delivered today (Sydney)" deltaTone="neutral" icon={<PackageCheck className="h-4 w-4" />} />
            </section>
            <LaundryStatistics />
          </div>
        ) : null}
      </div>
    </div>
  );
}
