"use client";

/**
 * Client requested add-ons (from the public quote page), put first in the
 * rail so they are not missed. Price each, Add to quote or Dismiss (the
 * requested-addons route prices it in and records a timeline note). Adding
 * rewrites the saved quote, so it waits while the page has unsaved changes.
 */
import * as React from "react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EInput } from "@/components/v2/admin/estate-kit";
import type { QuoteRequestedAddOn } from "@/lib/quotes/quote-record";
import { formatOrgDate } from "./format";

type Props = {
  items: QuoteRequestedAddOn[];
  timezone: string;
  busy: boolean;
  blockedReason: string | null;
  onAccept: (items: Array<QuoteRequestedAddOn & { price: number }>, thenReview: boolean) => void;
  onDismiss: (item: QuoteRequestedAddOn) => void;
};

const keyOf = (a: QuoteRequestedAddOn) => (a.id ? `id:${a.id}` : `label:${a.label.toLowerCase()}`);

export function RequestedAddOnsCard({ items, timezone, busy, blockedReason, onAccept, onDismiss }: Props) {
  const [prices, setPrices] = React.useState<Record<string, string>>(() => Object.fromEntries(items.map((a) => [keyOf(a), String(a.price || 0)])));
  const headingId = React.useId();
  if (items.length === 0) return null;
  const priced = (list: QuoteRequestedAddOn[]) => list.map((a) => ({ ...a, price: Math.max(0, Number(prices[keyOf(a)] ?? a.price) || 0) }));
  const disabled = busy || Boolean(blockedReason);

  return (
    <section aria-labelledby={headingId}>
      <ECard className="border-[hsl(var(--e-gold)/0.5)]">
        <ECardBody className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id={headingId} className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">Client requested add-ons</h2>
            <EPill tone="warn">{items.length}</EPill>
          </div>
          {items.map((a) => (
            <div key={keyOf(a)} className="space-y-2 border-t border-[hsl(var(--e-border))] pt-2 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 text-[0.8125rem]">
                  <b className="[overflow-wrap:anywhere]">{a.label}</b>{" "}
                  <span className="text-[hsl(var(--e-muted-foreground))]">from the public quote page{a.requestedAt ? `, ${formatOrgDate(a.requestedAt, timezone)}` : ""}</span>
                  {a.note ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">“{a.note}”</span> : null}
                </span>
                <label className="flex items-center gap-1 text-[0.75rem]">
                  <span aria-hidden>$</span>
                  <EInput aria-label={`Price for ${a.label}, ex GST`} className="h-9 w-20" type="number" min="0" inputMode="decimal" value={prices[keyOf(a)] ?? String(a.price)} disabled={disabled} onChange={(e) => setPrices((prev) => ({ ...prev, [keyOf(a)]: e.target.value }))} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <EButton size="sm" onClick={() => onAccept(priced([a]), false)} disabled={disabled}>Add to quote</EButton>
                <EButton size="sm" variant="outline" onClick={() => onDismiss(a)} disabled={disabled} aria-label={`Dismiss ${a.label}`}>Dismiss</EButton>
              </div>
            </div>
          ))}
          {items.length > 1 ? (
            <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--e-border))] pt-2">
              <EButton size="sm" variant="outline" onClick={() => onAccept(priced(items), false)} disabled={disabled}>Add all to quote</EButton>
              <EButton size="sm" variant="outline-gold" onClick={() => onAccept(priced(items), true)} disabled={disabled}>Add all and review email</EButton>
            </div>
          ) : null}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{blockedReason ?? "Adding changes the total; resend so the client sees it."}</p>
        </ECardBody>
      </ECard>
    </section>
  );
}
