"use client";

/**
 * The Overview tab as drawn. Main column: Coming up; Details beside Service
 * settings; Cleaning standard and pay beside Setup guide; Next-job checklist
 * beside Notes and onboarding; Performance; Documents and additional details
 * (only with data). Rail: Client, Access, Calendar sync, Laundry, Stock,
 * Billing rates.
 */
import { PropertyStatsStrip } from "../property-stats-strip";
import type { PropertyTab } from "@/lib/properties/detail-tabs";
import type { PropertyOverview } from "@/lib/properties/preview-types";
import { ComingUpCard } from "./coming-up-card";
import { CleaningStandardCard, DetailsCard } from "./profile-cards";
import { ServiceSettingsCard } from "./service-settings-card";
import { NotesCard, SetupGuideCard } from "./guide-notes-cards";
import { NextJobChecklist, type usePendingTasks } from "./next-job-checklist";
import { DocumentsCard } from "./documents-card";
import { AccessCard, LaundryCard } from "./access-laundry-cards";
import { IcalCard } from "./ical-card";
import { ClientCard, RatesCard, StockCard } from "./summary-cards";
import type { PropertyRecord } from "./property-record";
import type { SaveResult } from "./use-property-record";
import type { Remote } from "./use-property-summaries";

export function OverviewTab({
  property,
  overview,
  pending,
  timeZone,
  syncing,
  save,
  onSync,
  onChanged,
  onTab,
}: {
  property: PropertyRecord;
  overview: Remote<PropertyOverview>;
  pending: ReturnType<typeof usePendingTasks>;
  timeZone: string;
  syncing: boolean;
  save: (patch: Record<string, unknown>) => Promise<SaveResult>;
  onSync: () => void;
  onChanged: () => void;
  onTab: (tab: PropertyTab) => void;
}) {
  const data = overview.data;
  const nextJob = data?.comingUp.find((row) => row.job)?.dayKey ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
      <section aria-label="Overview" className="flex min-w-0 flex-1 flex-col gap-3">
        <ComingUpCard overview={overview} onShowJobs={() => onTab("jobs")} />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <DetailsCard property={property} save={save} />
          <ServiceSettingsCard property={property} save={save} />
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
          <CleaningStandardCard property={property} save={save} />
          <SetupGuideCard property={property} save={save} />
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
          <NextJobChecklist propertyId={property.id} pending={pending} nextJobDayKey={nextJob} compact />
          <NotesCard property={property} save={save} />
        </div>
        <PropertyStatsStrip propertyId={property.id} />
        <DocumentsCard property={property} overview={data} save={save} onSaved={overview.reload} />
      </section>
      <aside aria-label="Property details" className="flex w-full flex-col gap-3 lg:w-[340px] lg:flex-none">
        <ClientCard overview={overview} clientId={property.client?.id ?? null} clientName={property.client?.name ?? null} />
        <AccessCard property={property} overview={data} save={save} onOpenGuide={() => onTab("access")} />
        <IcalCard property={property} timeZone={timeZone} syncing={syncing} onSync={onSync} onChanged={onChanged} />
        <LaundryCard property={property} overview={data} save={async (patch) => { const result = await save(patch); if (result.ok) overview.reload(); return result; }} />
        <StockCard overview={overview} onOpenStock={() => onTab("stock")} />
        <RatesCard overview={overview} onOpenRates={() => onTab("billing")} />
      </aside>
    </div>
  );
}
