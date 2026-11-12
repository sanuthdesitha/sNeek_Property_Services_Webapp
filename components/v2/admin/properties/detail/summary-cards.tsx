"use client";

/**
 * Rail summaries: Client (contact, active properties, terms and — with
 * finance access only — what the client owes), Stock (items tracked and those
 * at or below reorder) and Billing rates. Each links to its full place. "–"
 * while loading; an unreadable summary says so.
 */
import Link from "next/link";
import { ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { formatCurrency } from "@/lib/utils";
import type { PropertyOverview } from "@/lib/properties/preview-types";
import { CardHead, KeyValues, Muted } from "./section-card";
import type { Remote } from "./use-property-summaries";

function enumLabel(value: string): string {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Unavailable({ overview }: { overview: Remote<PropertyOverview> }) {
  return overview.error ? <span role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">Could not load: {overview.error}</span> : <Muted>–</Muted>;
}

export function ClientCard({ overview, clientId, clientName }: { overview: Remote<PropertyOverview>; clientId: string | null; clientName: string | null }) {
  const client = overview.data?.client ?? null;
  return (
    <ECard className="flex flex-col gap-1.5 p-4">
      <CardHead title="Client" action={clientId ? <Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline" href={`/v2/admin/clients/${encodeURIComponent(clientId)}`}>Open client</Link> : null} />
      <b className="text-[0.875rem]">{client?.name ?? clientName ?? "Unknown client"}</b>
      {client ? (
        <>
          <Muted><span className="text-[0.8125rem]">{[client.phone, client.email].filter(Boolean).join(" · ") || "No contact details"}</span></Muted>
          <Muted>
            <span className="text-[0.8125rem]">
              {client.propertyCount} {client.propertyCount === 1 ? "property" : "properties"}
              {" · "}
              {client.paymentTermsDays !== null ? `${client.paymentTermsDays}-day terms` : "default terms"}
              {client.owingShown && client.owingAud !== null ? ` · ${formatCurrency(client.owingAud)} owing` : ""}
            </span>
          </Muted>
        </>
      ) : <Unavailable overview={overview} />}
    </ECard>
  );
}

export function StockCard({ overview, onOpenStock }: { overview: Remote<PropertyOverview>; onOpenStock: () => void }) {
  const stock = overview.data?.stock ?? null;
  return (
    <ECard className="flex flex-col gap-1.5 p-4">
      <CardHead title="Stock" action={<button type="button" className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline" onClick={onOpenStock}>Stock tab</button>} />
      {stock ? (
        stock.tracked === 0 ? (
          <Muted>No stock tracked.</Muted>
        ) : (
          <>
            <span className="text-[0.8125rem]">
              {stock.tracked} {stock.tracked === 1 ? "item" : "items"} tracked
              {stock.atOrBelowReorder.length > 0 ? <> · <EPill tone="warn">{stock.atOrBelowReorder.length} at or below reorder</EPill></> : " · none at or below reorder"}
            </span>
            {stock.atOrBelowReorder.length > 0 ? (
              <Muted>
                <span className="e-tnum text-[0.75rem]">
                  {stock.atOrBelowReorder.slice(0, 3).map((item) => `${item.name} ${item.onHand} on hand, par ${item.parLevel}, reorder at ${item.reorderThreshold}`).join(" · ")}
                  {stock.atOrBelowReorder.length > 3 ? ` · +${stock.atOrBelowReorder.length - 3} more` : ""}
                </span>
              </Muted>
            ) : null}
          </>
        )
      ) : <Unavailable overview={overview} />}
    </ECard>
  );
}

export function RatesCard({ overview, onOpenRates }: { overview: Remote<PropertyOverview>; onOpenRates: () => void }) {
  const rates = overview.data?.rates ?? null;
  return (
    <ECard className="flex flex-col gap-1.5 p-4">
      <CardHead title="Billing rates" action={<button type="button" className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline" onClick={onOpenRates}>Edit rates</button>} />
      {rates ? (
        rates.length === 0 ? (
          <Muted>No rates set. Jobs here need a fixed price to be invoiced.</Muted>
        ) : (
          <KeyValues
            rows={rates.map((rate) => [
              enumLabel(rate.jobType),
              <span key={rate.jobType} className="e-tnum">
                {formatCurrency(rate.baseCharge)} {rate.billingUnit === "PER_JOB" ? "per clean" : enumLabel(rate.billingUnit).toLowerCase()}
                {!rate.isActive ? <EPill className="ml-1">Inactive</EPill> : null}
              </span>,
            ])}
          />
        )
      ) : <Unavailable overview={overview} />}
    </ECard>
  );
}
