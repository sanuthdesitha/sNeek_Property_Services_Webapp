"use client";

/**
 * 3 · Discount and coupon, and Totals. The coupon is checked against the live
 * campaigns and staged; the discount route applies it (negative line, coupon
 * usage, GST) when the quote is saved — the totals shown are that estimate.
 */
import { Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EInput } from "@/components/v2/admin/estate-kit";
import { getGstDisplayLabel } from "@/lib/pricing/gst";
import { money } from "./model";
import { SectionCard } from "./section-card";
import type { QuoteBuilderState } from "./use-quote-builder";

export function SectionDiscountTotals({ builder, gstEnabled, savedDiscount }: { builder: QuoteBuilderState; gstEnabled: boolean; savedDiscount: boolean }) {
  const p = builder.pricing;
  const t = p.totals;
  const shown = t.discountAmount > 0 ? t.net : t;
  const applied = p.appliedDiscount;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_16rem]">
      <SectionCard eyebrow="3 · Discount and coupon">
        <div className="flex flex-wrap items-center gap-2">
          <EInput
            aria-label="Coupon code"
            className="w-40"
            value={p.couponInput}
            placeholder="Coupon code"
            onChange={(e) => p.setCouponInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void p.applyCoupon();
              }
            }}
          />
          <EButton type="button" size="sm" variant="outline" onClick={() => void p.applyCoupon()} disabled={p.discountBusy || !p.couponInput.trim()}>
            {p.discountBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
          </EButton>
          <EInput aria-label="Manual discount in dollars" className="w-32" type="number" min="0" step="0.01" inputMode="decimal" value={p.manualDiscountInput} placeholder="Manual $" onChange={(e) => p.setManualDiscountInput(e.target.value)} />
          <EButton type="button" size="sm" variant="outline" onClick={p.applyManualDiscount} disabled={p.discountBusy || !(Number(p.manualDiscountInput) > 0)}>Apply</EButton>
        </div>
        {applied ? (
          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <EPill tone={savedDiscount ? "ok" : "warn"}>{savedDiscount ? "Applied" : "Applies on save"}</EPill>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {applied.code ?? applied.label}, minus {money(t.discountAmount)}
              {applied.code ? <span className="text-[hsl(var(--e-muted-foreground))]"> · {applied.label}</span> : null}
            </span>
            <EButton type="button" size="sm" variant="ghost" onClick={p.clearDiscount} disabled={p.discountBusy}>Remove</EButton>
          </div>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No discount. A coupon or manual discount shows as a line on the quote.</p>
        )}
      </SectionCard>
      <SectionCard eyebrow="Totals">
        <dl className="e-tnum grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[0.875rem]">
          <dt className="text-[hsl(var(--e-muted-foreground))]">Subtotal</dt>
          <dd className="text-right">{money(t.subtotal)}</dd>
          <dt className="text-[hsl(var(--e-muted-foreground))]">Discount</dt>
          <dd className="text-right">{t.discountAmount > 0 ? `−${money(t.discountAmount)}` : money(0)}</dd>
          <dt className="text-[hsl(var(--e-muted-foreground))]">{getGstDisplayLabel({ gstEnabled })}</dt>
          <dd className="text-right">{money(shown.gstAmount)}</dd>
          <dt className="font-[600]">Total</dt>
          <dd className="text-right font-[600] text-[hsl(var(--e-gold-ink))]">{money(shown.totalAmount)}</dd>
        </dl>
      </SectionCard>
    </div>
  );
}
