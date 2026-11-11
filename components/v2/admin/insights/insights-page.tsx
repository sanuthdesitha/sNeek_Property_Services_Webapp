"use client";

/**
 * Insights (/v2/admin/reports), as drawn: heading with the period in words,
 * period chips, client filter and Export in the header; tabs Business,
 * Properties, Clients, Cleaners, Time and cost and Client report PDFs. The
 * PDFs tab is the existing reports manager in panel mode. Everything is in the
 * URL; each tab loads its own data, so one failed section never blanks the
 * page.
 */
import * as React from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { E_CHIP_CLASS } from "@/components/v2/ui/filter-chips";
import { useQualityRead } from "@/components/v2/admin/quality/hub/use-quality-read";
import { ReportsManager } from "@/components/v2/admin/reports/reports-manager";
import { rangeLabel } from "@/lib/insights/period";
import { insightsApiQuery } from "@/lib/insights/url-state";
import { INSIGHTS_TAB_LABEL, INSIGHTS_TABS, type InsightsTab } from "@/lib/insights/types";
import { BusinessTab } from "./business-tab";
import { CleanersTab, ClientsTab, PropertiesTab, type TableControls } from "./entity-tabs";
import { isOptions, type InsightsContext } from "./insights-types";
import { PeriodChips } from "./period-chips";
import { TimeTab } from "./time-tab";
import { INSIGHTS_PATH, useInsightsState } from "./use-insights-state";

function InsightsTabs({ active, hrefFor }: { active: InsightsTab; hrefFor: (tab: InsightsTab) => string }) {
  return (
    <nav aria-label="Insights sections" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {INSIGHTS_TABS.map((tab) => (
          <Link
            key={tab}
            href={hrefFor(tab)}
            scroll={false}
            aria-current={tab === active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-[2.5rem] items-center whitespace-nowrap border-b-2 px-3 text-[0.8125rem] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
              tab === active
                ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]"
                : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
            )}
          >
            {INSIGHTS_TAB_LABEL[tab]}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function ClientFilter({ value, onChange }: { value: string; onChange: (clientId: string) => void }) {
  const options = useQualityRead("/api/admin/insights/options", isOptions, "Clients could not be loaded.");
  return (
    <label className={cn(E_CHIP_CLASS, "relative pr-1")}>
      <span className="sr-only">Client</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full max-w-[12rem] cursor-pointer appearance-none bg-transparent pr-1 text-inherit outline-none"
        title={options.error ?? undefined}
      >
        <option value="">Client: all</option>
        {(options.data?.clients ?? []).map((client) => (
          <option key={client.id} value={client.id}>{`Client: ${client.name}`}</option>
        ))}
        {value && !options.data?.clients.some((client) => client.id === value) ? <option value={value}>Client: selected</option> : null}
      </select>
    </label>
  );
}

export function InsightsPage({ context }: { context: InsightsContext }) {
  const { state, update, hrefForTab } = useInsightsState();
  const apiQuery = insightsApiQuery(state);
  const previousLabel = state.period.previous ? rangeLabel(state.period.previous) : null;
  const onPdfs = state.tab === "pdfs";
  const exportParams = new URLSearchParams(apiQuery);
  exportParams.set("tab", state.tab);
  if (state.sort) exportParams.set("sort", state.sort);
  if (state.dir) exportParams.set("dir", state.dir);

  const propertiesHref = (sort?: string, dir?: string) => {
    const base = new URL(hrefForTab("properties"), "http://internal");
    if (sort) base.searchParams.set("sort", sort);
    if (dir) base.searchParams.set("dir", dir);
    return `${INSIGHTS_PATH}?${base.searchParams.toString()}`;
  };

  const controls: TableControls = {
    apiQuery,
    sort: state.sort,
    dir: state.dir,
    page: state.page,
    money: context.access.finance,
    onSort: (sort, dir) => update({ sort, dir }),
    onPage: (page) => update({ page }),
  };

  const description = onPdfs
    ? "The report sent to clients after each clean: who sees it, theme, PDF and regeneration."
    : `What the collected data says about the business. ${rangeLabel(state.period)}${previousLabel ? ` compared with ${previousLabel}` : ""}.`;

  return (
    <div className="space-y-4">
      <EPageHeader
        title="Insights"
        description={description}
        actions={
          onPdfs ? null : (
            <>
              <PeriodChips period={state.period} onChange={(period) => update({ period })} />
              <ClientFilter value={state.clientId} onChange={(clientId) => update({ clientId })} />
              <EButton asChild size="sm" variant="outline">
                <a href={`/api/admin/insights/export?${exportParams.toString()}`} download title="Download this tab's table for this period and client as CSV">
                  <Download aria-hidden className="h-3.5 w-3.5" /> Export
                </a>
              </EButton>
            </>
          )
        }
      />
      <InsightsTabs active={state.tab} hrefFor={hrefForTab} />
      <div className="min-w-0">
        <h2 className="sr-only">{INSIGHTS_TAB_LABEL[state.tab]}</h2>
        {state.tab === "business" ? (
          <BusinessTab key={apiQuery} apiQuery={apiQuery} previousLabel={previousLabel} propertiesHref={propertiesHref} />
        ) : null}
        {state.tab === "properties" ? <PropertiesTab controls={controls} /> : null}
        {state.tab === "clients" ? <ClientsTab controls={controls} /> : null}
        {state.tab === "cleaners" ? <CleanersTab controls={controls} /> : null}
        {state.tab === "time" ? <TimeTab apiQuery={apiQuery} propertiesHref={propertiesHref()} /> : null}
        {onPdfs ? <ReportsManager timeZone={context.timeZone} canManage={context.canManageReports} /> : null}
      </div>
      {onPdfs || context.access.finance ? null : (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Revenue, cleaner cost, margin and payment figures need finance access and are not included.
        </p>
      )}
    </div>
  );
}
