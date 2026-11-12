"use client";

/**
 * The pricing tabs of Quotes and pricing, each the existing editor composed
 * as drawn, with its existing access:
 * - Rate card: EstatePricingEditor behind the same PIN lock as the old page.
 * - Price book: PricebookSection, editable by administrators only.
 * - Holiday rates and Pricing variables: administrators (as in Settings, whose
 *   tabs and server routes are ADMIN-only); others are told so.
 * - Client rates: the property billing-rate editor for a chosen property.
 */
import * as React from "react";
import { EAlert, ECard } from "@/components/v2/ui/primitives";
import { EstatePageLock } from "@/components/v2/admin/pricing/estate-page-lock";
import { EstatePricingEditor } from "@/components/v2/admin/pricing/estate-pricing-editor";
import { PricebookSection } from "@/components/v2/admin/pricing/pricebook-section";
import { HolidayRatesWorkspace } from "@/components/finance/holiday-rates-workspace";
import { PricingVariablesSection } from "@/components/v2/admin/settings/pricing-variables-section";
import { PropertyBillingRates } from "@/components/v2/admin/properties/property-billing-rates";
import type { QuotesTab } from "@/lib/quotes/quotes-tabs";
import type { PricingVariable } from "@/lib/settings";

type PricingTabProps = { tab: Exclude<QuotesTab, "pipeline">; isAdmin: boolean; pricingVariables: PricingVariable[] };

function AdminOnly({ what }: { what: string }) {
  return <EAlert tone="info" title="Administrators only">{what} can be changed by administrators. Ask an administrator if a value needs updating.</EAlert>;
}

type PropertyOption = { id: string; name: string; suburb: string | null };

function ClientRates() {
  const [properties, setProperties] = React.useState<PropertyOption[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [propertyId, setPropertyId] = React.useState("");

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/properties", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as Array<{ id: string; name: string; suburb?: string | null; isActive?: boolean }> | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !Array.isArray(body)) {
          setError("Could not load properties.");
          return;
        }
        setProperties(body.filter((row) => row.isActive !== false).map((row) => ({ id: row.id, name: row.name, suburb: row.suburb ?? null })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load properties.");
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">What each client is charged per job type at one property. The same editor is on the property page.</p>
      <label className="flex max-w-md flex-col gap-1">
        <span className="text-[0.75rem] font-[550]">Property</span>
        <select
          className="h-11 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.875rem]"
          value={propertyId}
          disabled={!properties}
          onChange={(event) => setPropertyId(event.target.value)}
        >
          <option value="">{properties ? "Choose a property" : error ? "Properties unavailable" : "Loading properties…"}</option>
          {properties?.map((property) => (
            <option key={property.id} value={property.id}>{property.name}{property.suburb ? ` · ${property.suburb}` : ""}</option>
          ))}
        </select>
      </label>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {propertyId ? (
        <ECard className="p-4">
          <PropertyBillingRates key={propertyId} propertyId={propertyId} />
        </ECard>
      ) : null}
    </div>
  );
}

export function PricingTab({ tab, isAdmin, pricingVariables }: PricingTabProps) {
  switch (tab) {
    case "rate-card":
      return (
        <EstatePageLock lockId="pricing" title="Rate card is locked" description="Enter your own PIN to view and edit service pricing.">
          <EstatePricingEditor />
        </EstatePageLock>
      );
    case "price-book":
      return (
        <div className="space-y-3">
          {!isAdmin ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Edit: administrators · view: operations managers.</p> : null}
          {/* The old Pricing page kept the price book behind the same PIN; it still is (one unlock opens both tabs). */}
          <EstatePageLock lockId="pricing" title="Price book is locked" description="Enter your own PIN to view the price book.">
            <PricebookSection canEdit={isAdmin} />
          </EstatePageLock>
        </div>
      );
    case "holiday-rates":
      return isAdmin ? <HolidayRatesWorkspace panel /> : <AdminOnly what="Public holiday rates" />;
    case "pricing-variables":
      return isAdmin ? <PricingVariablesSection initial={pricingVariables} readOnly={false} /> : <AdminOnly what="Pricing variables" />;
    case "client-rates":
      return <ClientRates />;
  }
}
