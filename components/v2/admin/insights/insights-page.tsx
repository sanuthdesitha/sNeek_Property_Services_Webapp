"use client";

/**
 * Insights (/v2/admin/reports), as drawn: heading with the period in words,
 * then period chips, the "Client: all" filter chip, Export and "Email monthly"
 * in the header (hidden on the PDFs tab, where none of them applies); tabs Business,
 * Properties, Clients, Cleaners, Time and cost and Client report PDFs. The
 * PDFs tab is the existing reports manager in panel mode. Everything is in the
 * URL; each tab loads its own data, so one failed section never blanks the
 * page.
 */
import * as React from "react";
import Link from "next/link";
import { Download, Mail, MoreHorizontal } from "lucide-react";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { PhoneActionSheet } from "@/components/v2/admin/phone-action-sheet";
import { cn } from "@/lib/utils";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ReportsManager } from "@/components/v2/admin/reports/reports-manager";
import { comparisonLabel, rangeLabel } from "@/lib/insights/period";
import { insightsApiQuery } from "@/lib/insights/url-state";
import { INSIGHTS_TAB_LABEL, INSIGHTS_TABS, type InsightsTab } from "@/lib/insights/types";
import { BusinessTab } from "./business-tab";
import { CleanersTab, ClientsTab, PropertiesTab, type TableControls } from "./entity-tabs";
import { ClientFilter } from "./client-filter";
import type { InsightsContext } from "./insights-types";
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

/**
 * "Email monthly", as drawn: a header button showing the monthly Insights
 * email's real state. An administrator opens its setting (Settings →
 * Notifications → Monthly Insights email); the setting is owner-only, so
 * anyone else sees the state with the reason they cannot open it. No state is
 * shown when the setting could not be read.
 */
export function MonthlyEmailButton({ state }: { state: InsightsContext["monthlyEmail"] }) {
  if (!state) return null;
  const status = state.enabled ? "On" : "Off";
  const content = (
    <>
      <Mail aria-hidden className="h-3.5 w-3.5" /> Email monthly
      <span
        className={cn(
          "ml-0.5 inline-flex h-[18px] items-center rounded-[var(--e-radius-pill)] px-1.5 text-[0.6875rem] font-[600]",
          state.enabled
            ? "bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]"
            : "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-text-secondary))]",
        )}
      >
        {status}
      </span>
    </>
  );
  if (!state.canConfigure) {
    return (
      <EButton size="sm" variant="outline" aria-disabled="true" className="cursor-default opacity-80" title="An administrator sets this up in Settings." onClick={(event) => event.preventDefault()}>
        {content}
        <span className="sr-only">. An administrator sets this up in Settings.</span>
      </EButton>
    );
  }
  return (
    <EButton asChild size="sm" variant="outline">
      <Link href="/v2/admin/settings?tab=insights-email" title="Open the monthly Insights email setting">
        {content}
      </Link>
    </EButton>
  );
}

/**
 * Phones (board "M-InsightsForms"): Export and the monthly email setting in
 * the header's "⋯" sheet, the very same link and button as on desktop.
 */
function InsightsPhoneMenu({ exportHref, monthlyEmail }: { exportHref: string; monthlyEmail: InsightsContext["monthlyEmail"] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <EButton size="icon" variant="outline" aria-label="More Insights actions" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </EButton>
      <PhoneActionSheet
        open={open}
        onOpenChange={setOpen}
        title="Insights"
        items={[]}
        lead={
          <div className="flex flex-col gap-2 [&>*]:w-full [&>*]:justify-start">
            <EButton asChild variant="outline">
              <a href={exportHref} download title="Download this tab's table for this period and client as CSV" onClick={() => setOpen(false)}>
                <Download aria-hidden className="h-3.5 w-3.5" /> Export
              </a>
            </EButton>
            <MonthlyEmailButton state={monthlyEmail ?? null} />
          </div>
        }
      />
    </>
  );
}

export function InsightsPage({ context }: { context: InsightsContext }) {
  const { state, update, hrefForTab } = useInsightsState();
  const phone = useIsPhone();
  const apiQuery = insightsApiQuery(state);
  const previousLabel = state.period.previous ? rangeLabel(state.period.previous) : null;
  const comparedWith = state.period.previous ? comparisonLabel(state.period, state.period.previous) : null;
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
    : `What the collected data says about the business. ${rangeLabel(state.period)}${comparedWith ? ` compared with ${comparedWith}` : ""}.`;

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
              {phone ? (
                <InsightsPhoneMenu exportHref={`/api/admin/insights/export?${exportParams.toString()}`} monthlyEmail={context.monthlyEmail ?? null} />
              ) : (
                <>
                  <EButton asChild size="sm" variant="outline">
                    <a href={`/api/admin/insights/export?${exportParams.toString()}`} download title="Download this tab's table for this period and client as CSV">
                      <Download aria-hidden className="h-3.5 w-3.5" /> Export
                    </a>
                  </EButton>
                  <MonthlyEmailButton state={context.monthlyEmail ?? null} />
                </>
              )}
            </>
          )
        }
      />
      <InsightsTabs active={state.tab} hrefFor={hrefForTab} />
      <div className="min-w-0">
        <h2 className="sr-only">{INSIGHTS_TAB_LABEL[state.tab]}</h2>
        {state.tab === "business" ? (
          <BusinessTab
            key={apiQuery}
            apiQuery={apiQuery}
            previousLabel={previousLabel}
            propertiesHref={propertiesHref}
            sortControls={{ sort: state.sort, dir: state.dir, onSort: (sort, dir) => update({ sort, dir }) }}
          />
        ) : null}
        {state.tab === "properties" ? <PropertiesTab controls={controls} /> : null}
        {state.tab === "clients" ? <ClientsTab controls={controls} /> : null}
        {state.tab === "cleaners" ? <CleanersTab controls={controls} /> : null}
        {state.tab === "time" ? <TimeTab apiQuery={apiQuery} propertiesHref={propertiesHref("ratio", "desc")} /> : null}
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
