"use client";

/**
 * Quotes and pricing (owner board, 2026-11): page header with Export and
 * "New quote ▾", and six tabs — Leads and quotes, Rate card (behind the PIN as
 * before), Price book (read-only for operations managers), Holiday rates,
 * Pricing variables (administrators, as in Settings) and Client rates. The tab
 * lives in ?tab= so the old Pricing page can redirect into it.
 */
import * as React from "react";
import { Lock } from "lucide-react";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EPill } from "@/components/v2/ui/pill";
import { cn } from "@/lib/utils";
import { rememberCurrentView } from "@/lib/navigation/view-memory";
import { QUOTES_TABS, parseQuotesTab, type QuotesTab } from "@/lib/quotes/quotes-tabs";
import type { PricingVariable } from "@/lib/settings";
import { PipelineList } from "./pipeline-list";
import { PricingTab } from "./pricing-tabs";

type QuotesWorkspaceProps = {
  initialTab: QuotesTab;
  isAdmin: boolean;
  newLeads: number | null;
  pricingVariables: PricingVariable[];
  timezone: string;
  services: Array<{ value: string; label: string }>;
};

export function QuotesWorkspace({ initialTab, isAdmin, newLeads, pricingVariables, timezone, services }: QuotesWorkspaceProps) {
  const [tab, setTab] = React.useState<QuotesTab>(initialTab);
  const [exportHref, setExportHref] = React.useState("/api/admin/quotes/pipeline?format=csv&stage=open");

  React.useEffect(() => {
    const sync = () => setTab(parseQuotesTab(new URLSearchParams(window.location.search).get("tab")));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function choose(next: QuotesTab) {
    const params = new URLSearchParams(window.location.search);
    if (next === "pipeline") params.delete("tab");
    else params.set("tab", next);
    // Pipeline-only state does not follow into a pricing tab.
    if (next !== "pipeline") ["open", "stage", "q", "page", "sort", "dir", "service"].forEach((key) => params.delete(key));
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    rememberCurrentView();
    setTab(next);
  }

  return (
    <div className="space-y-5">
      <EPageHeader
        eyebrow="Money"
        title="Quotes and pricing"
        description="Every enquiry from first contact to signed quote, and the rates every quote is priced from."
        actions={
          <>
            {tab === "pipeline" ? (
              <a
                href={exportHref}
                className="inline-flex h-8 items-center rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))]"
              >
                Export
              </a>
            ) : null}
            <ERowMenu
              label="New quote"
              trigger={<>New quote ▾</>}
              items={[
                { key: "new", label: "New quote", href: "/v2/admin/quotes/new" },
                { key: "case", label: "Repair quote from a case", href: "/v2/admin/cases" },
              ]}
            />
          </>
        }
      />
      <div role="tablist" aria-label="Quotes and pricing" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {QUOTES_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => choose(item.key)}
            className={cn(
              "inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[var(--e-radius)] border px-3 text-[0.8125rem] font-[550]",
              tab === item.key
                ? "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                : "border-transparent text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
            )}
          >
            {item.label}
            {item.key === "rate-card" ? <Lock aria-label="PIN required" className="h-3.5 w-3.5" /> : null}
            {item.key === "pipeline" && newLeads ? <EPill tone="gold">{newLeads} new</EPill> : null}
          </button>
        ))}
      </div>
      {tab === "pipeline" ? (
        <PipelineList timezone={timezone} services={services} onExportHrefChange={setExportHref} />
      ) : (
        <PricingTab tab={tab} isAdmin={isAdmin} pricingVariables={pricingVariables} />
      )}
    </div>
  );
}
