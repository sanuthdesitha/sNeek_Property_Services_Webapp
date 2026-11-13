"use client";

/**
 * The property page (`/v2/admin/properties/[id]`), as drawn: header with
 * "New job here" and More, key facts, tabs Overview / Checklist and forms /
 * Access guide / Stock / Jobs and history / Care and planning / Billing rates.
 * Every section is an existing component or endpoint, composed and moved:
 *   GET/PATCH/DELETE /api/admin/properties/:id, /integration (+ /undo),
 *   /pending-tasks, /stats, /overview (Coming up and rail summaries),
 *   POST /api/admin/inventory/property/:id/set-levels.
 * Old `?tab=` links keep working (profile → Overview, inventory → Stock).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { EButton, EEmptyState } from "@/components/v2/ui/primitives";
import { OperationsDisclosure } from "@/components/operations/ui";
import { PropertyCareWorkspace } from "@/components/property-care/workspace";
import { resolvePropertyTab, type PropertyTab } from "@/lib/properties/detail-tabs";
import { NfcTagsCard } from "./nfc-tags-card";
import { PropertyDeepCleanPlanning } from "./property-deep-clean-planning";
import { PropertyCadenceLedger } from "./property-cadence-ledger";
import { PropertyJobsHistory } from "./property-jobs-history";
import { PropertyBillingRates } from "./property-billing-rates";
import { PropertyChecklistProfile, PropertyFormOverrides } from "./property-checklist-profile";
import { PropertyAccessGuideEditor } from "./property-access-guide-editor";
import { PropertyHeader, PropertyKeyFacts, PropertyPhoneActions } from "./detail/property-header";
import { PropertyTabBar } from "./detail/property-tab-bar";
import { OverviewTab } from "./detail/overview-tab";
import { StockTab } from "./detail/stock-tab";
import { NextJobChecklist, usePendingTasks } from "./detail/next-job-checklist";
import { usePropertyRecord } from "./detail/use-property-record";
import { usePropertyOverview, usePropertyStats } from "./detail/use-property-summaries";

export function PropertyDetail({ propertyId, timeZone = "Australia/Sydney", initialTab }: { propertyId: string; timeZone?: string; initialTab?: string }) {
  const { state, reload, save } = usePropertyRecord(propertyId);
  const overview = usePropertyOverview(propertyId);
  const stats = usePropertyStats(propertyId);
  const pending = usePendingTasks(propertyId);
  const [remembered, setRemembered] = useRestorableState<string>("property-detail:tab", "overview");
  const [syncing, setSyncing] = useState(false);
  const tab = resolvePropertyTab(remembered);

  // An explicit ?tab= (a deep link, e.g. Inventory → By property) wins over the remembered tab.
  useEffect(() => {
    const requested = initialTab ?? new URLSearchParams(window.location.search).get("tab");
    if (requested) setRemembered(resolvePropertyTab(requested));
  }, [propertyId, initialTab, setRemembered]);

  function selectTab(next: PropertyTab) {
    setRemembered(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url.toString());
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const response = await fetch(`/api/admin/properties/${propertyId}/integration`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; summary?: { reservationsCreated?: number; jobsCreated?: number; jobsUpdated?: number } };
      if (!response.ok) {
        toast({ title: "Sync failed", description: body.error ?? "Could not trigger sync.", variant: "destructive" });
        return;
      }
      const summary = body.summary ?? {};
      toast({ title: "Sync completed", description: `${summary.reservationsCreated ?? 0} reservations, ${summary.jobsCreated ?? 0} jobs created, ${summary.jobsUpdated ?? 0} updated.` });
    } finally {
      setSyncing(false);
      reload();
      overview.reload();
    }
  }

  if (state.status === "loading") {
    return <div role="status" className="flex items-center justify-center py-24 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading property…</div>;
  }
  if (state.status === "missing" || state.status === "failed") {
    return (
      <div className="space-y-6">
        <h1 className="sr-only">Property</h1>
        <EEmptyState
          eyebrow={state.status === "missing" ? "Not found" : "Could not load"}
          title="Property unavailable"
          description={state.status === "missing" ? "This property could not be loaded. It may have been removed." : state.message}
          action={
            <div className="flex gap-2">
              {state.status === "failed" ? <EButton variant="outline" onClick={reload}>Try again</EButton> : null}
              <EButton asChild variant="outline"><Link href="/v2/admin/properties">Back to properties</Link></EButton>
            </div>
          }
        />
      </div>
    );
  }

  const property = state.property;
  const counts: Partial<Record<PropertyTab, number>> = {
    checklist: pending.tasks.length,
    access: Array.isArray(property.accessGuide) ? property.accessGuide.length : undefined,
    stock: property.propertyStock.length,
    jobs: property._count?.jobs,
    billing: overview.data?.rates.length,
  };
  const changed = () => {
    reload();
    overview.reload();
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PropertyHeader property={property} syncing={syncing} onSync={syncNow} />
      <PropertyKeyFacts property={property} overview={overview} stats={stats} />
      <PropertyTabBar active={tab} counts={counts} onSelect={selectTab} />

      <div role="tabpanel" id={`property-tab-${tab}`} aria-labelledby={`property-tab-button-${tab}`} className="min-w-0">
        {tab === "overview" ? (
          <OverviewTab property={property} overview={overview} pending={pending} timeZone={timeZone} syncing={syncing} save={save} onSync={syncNow} onChanged={changed} onTab={selectTab} />
        ) : null}
        {tab === "checklist" ? (
          <div className="space-y-4">
            <PropertyChecklistProfile propertyId={propertyId} />
            <PropertyFormOverrides propertyId={propertyId} />
            <NextJobChecklist propertyId={propertyId} pending={pending} nextJobDayKey={overview.data?.comingUp.find((row) => row.job)?.dayKey ?? null} />
          </div>
        ) : null}
        {tab === "access" ? (
          <div className="space-y-4">
            <PropertyAccessGuideEditor propertyId={propertyId} />
            <NfcTagsCard propertyId={propertyId} />
          </div>
        ) : null}
        {tab === "stock" ? <StockTab property={property} onSaved={changed} /> : null}
        {tab === "jobs" ? (
          <div className="space-y-4">
            <PropertyCadenceLedger propertyId={propertyId} />
            <PropertyJobsHistory propertyId={propertyId} />
          </div>
        ) : null}
        {tab === "care" ? (
          <div className="space-y-4">
            <OperationsDisclosure title="Property memory and care" description="Standing notes, planned care tasks and what past cleans recorded here." icon={<NotebookPen />}>
              <PropertyCareWorkspace propertyId={propertyId} timeZone={timeZone} panel />
            </OperationsDisclosure>
            <PropertyDeepCleanPlanning propertyId={propertyId} />
          </div>
        ) : null}
        {tab === "billing" ? <PropertyBillingRates propertyId={propertyId} /> : null}
      </div>
      <PropertyPhoneActions property={property} syncing={syncing} onSync={syncNow} />
    </div>
  );
}
