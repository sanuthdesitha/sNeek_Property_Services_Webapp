"use client";

/**
 * Service and pricing state of the quote builder, unchanged rules: rate-card
 * pricing through `POST /api/admin/quotes/price`, pricing variables re-priced
 * live once priced, extras (catalog and custom) as lines, the staged discount
 * (coupon checked against the live campaigns) applied by the discount route
 * on save, and totals through `builderTotals` (the one GST rule).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";
import type { PricingSelections, PricingVariable } from "@/lib/pricing/variables";
import { CUSTOM_OPTION, isPerUnitExtra, money, type AppliedDiscount, type BuilderSeed, type CustomExtra, type LineItem, type PricingSource, type ServiceOption, type VariableLine } from "./model";
import { builderTotals, couponAmount, type CouponCampaign, type ExtraDetail } from "./payload";

type Options = { seed: BuilderSeed | null; services: ServiceOption[]; pricingVariables: PricingVariable[]; gstEnabled: boolean; initialServiceType: string };

function initialChoices(seed: BuilderSeed | null, variables: PricingVariable[]): Record<string, string> {
  if (seed) return seed.variableChoices;
  const initial: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.kind === "number") continue;
    const fallback = variable.defaultOptionId ?? variable.options?.[0]?.id ?? "";
    if (fallback) initial[variable.id] = fallback;
  }
  return initial;
}

export function useQuotePricing({ seed, services, pricingVariables, gstEnabled, initialServiceType }: Options) {
  const [serviceType, setServiceType] = useState<string>(initialServiceType);
  const [bedrooms, setBedrooms] = useState(seed?.bedrooms ?? "2");
  const [bathrooms, setBathrooms] = useState(seed?.bathrooms ?? "1");
  const [sqm, setSqm] = useState(seed?.sqm ?? "50");
  const [windows, setWindows] = useState("10");
  const [items, setItems] = useState("3");
  const [hours, setHours] = useState("3");
  const [bandIndex, setBandIndex] = useState("0");
  const [lineItems, setLineItemsRaw] = useState<LineItem[]>(seed?.lineItems ?? []);
  const [selectedExtras, setSelectedExtras] = useState<string[]>(seed?.selectedExtras ?? []);
  const [customExtras, setCustomExtras] = useState<CustomExtra[]>(seed?.customExtras ?? []);
  const [extraQtys, setExtraQtys] = useState<Record<string, string>>(seed?.extraQtys ?? {});
  const [variableChoices, setVariableChoices] = useState<Record<string, string>>(() => initialChoices(seed, pricingVariables));
  const [variableCustom, setVariableCustom] = useState<Record<string, string>>(seed?.variableCustom ?? {});
  const [variableNumbers, setVariableNumbers] = useState<Record<string, string>>(seed?.variableNumbers ?? {});
  const [variableLines, setVariableLines] = useState<VariableLine[]>([]);
  const [pricing, setPricing] = useState(false);
  const [hasAutoPriced, setHasAutoPriced] = useState(false);
  const [pricingSource, setPricingSource] = useState<PricingSource>(seed?.pricingSource ?? "unknown");
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(seed?.seededDiscount ?? null);
  const seededHadDiscount = useRef(Boolean(seed?.seededDiscount));
  const [couponInput, setCouponInput] = useState("");
  const [manualDiscountInput, setManualDiscountInput] = useState("");
  const [discountBusy, setDiscountBusy] = useState(false);

  const service = useMemo(() => services.find((s) => s.jobType === serviceType) ?? services[0], [services, serviceType]);
  const serviceLabel = service?.label ?? String(serviceType).replace(/_/g, " ");
  const extraQty = (id: string) => Math.max(0, Number(extraQtys[id] ?? "1") || 0);

  /** A hand edit of the base lines after rate-card pricing is recorded as "edited". */
  function setLineItems(update: (prev: LineItem[]) => LineItem[]) {
    setLineItemsRaw(update);
    setPricingSource((prev) => (prev === "rate-card" ? "rate-card-edited" : prev));
  }

  const serviceContext = useMemo<PricingSelections>(() => {
    const out: PricingSelections = {};
    for (const variable of pricingVariables) {
      if (variable.kind === "number") {
        const raw = (variableNumbers[variable.id] ?? "").trim();
        const qty = Number(raw);
        if (raw && Number.isFinite(qty) && qty !== 0) out[variable.id] = qty;
        continue;
      }
      const choice = variableChoices[variable.id];
      if (!choice) continue;
      if (choice === CUSTOM_OPTION) {
        const typed = (variableCustom[variable.id] ?? "").trim();
        if (typed) out[variable.id] = typed;
        continue;
      }
      out[variable.id] = choice;
    }
    return out;
  }, [pricingVariables, variableChoices, variableCustom, variableNumbers]);

  const selectedExtraDetails = useMemo<ExtraDetail[]>(
    () => [
      ...selectedExtras.map((id) => EXTRAS_BY_ID[id]).filter(Boolean).map((e) => ({ id: e.id, label: e.label, price: e.price, instructions: e.instructions })),
      ...customExtras.map((c) => ({ id: c.id, label: c.label, price: c.price, instructions: c.instructions })),
    ],
    [selectedExtras, customExtras],
  );
  const extraLines = useMemo<LineItem[]>(
    () =>
      selectedExtraDetails.map((e) => {
        const qty = isPerUnitExtra(e.label) ? extraQty(e.id) : 1;
        return { label: e.label, unitPrice: e.price, qty, total: Math.round(e.price * qty * 100) / 100 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedExtraDetails, extraQtys],
  );
  const variableLineItems = useMemo<LineItem[]>(() => variableLines.map((l) => ({ label: l.label, unitPrice: l.amount, qty: 1, total: l.amount })), [variableLines]);
  const allLines = useMemo(() => [...lineItems, ...variableLineItems, ...extraLines], [lineItems, variableLineItems, extraLines]);
  const totals = useMemo(() => builderTotals(allLines, gstEnabled, appliedDiscount?.amount ?? 0), [allLines, gstEnabled, appliedDiscount]);

  function priceInputs() {
    const model = service?.model;
    return {
      serviceType,
      bedrooms: model === "ROOMS" ? Number(bedrooms) || 0 : undefined,
      bathrooms: model === "ROOMS" ? Number(bathrooms) || 0 : undefined,
      sqm: model === "AREA" || model === "ROOMS" ? Number(sqm) || 0 : undefined,
      windows: model === "WINDOWS" ? Number(windows) || 0 : undefined,
      items: model === "ITEMS" ? Number(items) || 0 : undefined,
      hours: model === "HOURLY" ? Number(hours) || 0 : undefined,
      bandIndex: model === "BANDS" ? Number(bandIndex) || 0 : undefined,
    };
  }

  async function autoPrice(opts: { silent?: boolean } = {}) {
    setPricing(true);
    try {
      const res = await fetch("/api/admin/quotes/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...priceInputs(), serviceContext: Object.keys(serviceContext).length > 0 ? serviceContext : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not price this quote.");
      if (body.requiresManualQuote) {
        setPricingSource("manual");
        if (!opts.silent) toast({ title: "Manual quote needed", description: body.message ?? "Add line items by hand." });
        return;
      }
      const combined: LineItem[] = Array.isArray(body.result?.lineItems) ? body.result.lineItems : [];
      const returnedVariableLines: VariableLine[] = Array.isArray(body.result?.variableLines) ? body.result.variableLines : [];
      if (combined.length === 0) {
        if (!opts.silent) toast({ title: "No price returned", description: "Add line items manually.", variant: "destructive" });
        return;
      }
      const baseCount = Math.max(0, combined.length - returnedVariableLines.length);
      setLineItemsRaw(combined.slice(0, baseCount).map((i) => ({ label: i.label, unitPrice: Number(i.unitPrice), qty: Number(i.qty), total: Number(i.total) })));
      setVariableLines(returnedVariableLines.map((l) => ({ label: String(l.label), amount: Number(l.amount) || 0 })));
      setHasAutoPriced(true);
      setPricingSource("rate-card");
      if (!opts.silent) toast({ title: "Priced from rate card", description: `${combined.length} line item(s) added.` });
    } catch (err) {
      if (!opts.silent) toast({ title: "Pricing failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPricing(false);
    }
  }

  const serviceContextKey = JSON.stringify(serviceContext);
  useEffect(() => {
    if (!hasAutoPriced) return;
    const timer = setTimeout(() => void autoPrice({ silent: true }), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceContextKey]);

  function updateItem(idx: number, patch: Partial<LineItem>) {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const next = { ...li, ...patch };
        next.total = Number((Number(next.unitPrice || 0) * Number(next.qty || 0)).toFixed(2));
        return next;
      }),
    );
  }

  function addCustomExtra(label: string, price: number, instructions: string) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || Math.random().toString(36).slice(2, 8);
    setCustomExtras((prev) => [...prev, { id: `custom:${slug}-${Date.now().toString(36)}`, label, price, instructions }]);
  }

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setDiscountBusy(true);
    try {
      const params = new URLSearchParams({ code, serviceType, subtotal: String(totals.subtotal) });
      const res = await fetch(`/api/public/campaign?${params.toString()}`);
      const body = (await res.json().catch(() => ({}))) as { valid?: boolean; reason?: string; campaign?: CouponCampaign };
      if (!res.ok || !body.valid || !body.campaign) {
        toast({ title: "Coupon not applied", description: body.reason ?? "That code isn't valid for this quote.", variant: "destructive" });
        return;
      }
      const amount = couponAmount(body.campaign, totals.subtotal);
      if (amount <= 0) {
        toast({ title: "Coupon has no effect", description: "This code produces no discount on the current total.", variant: "destructive" });
        return;
      }
      setAppliedDiscount({ code: body.campaign.code, label: `Discount · ${body.campaign.title} (${body.campaign.code})`, amount });
      setCouponInput("");
      toast({ title: "Coupon staged", description: `${body.campaign.code} — will apply −${money(amount)} on save.` });
    } finally {
      setDiscountBusy(false);
    }
  }

  function applyManualDiscount() {
    const amount = Math.min(totals.subtotal, Math.max(0, Number(manualDiscountInput) || 0));
    if (amount <= 0) {
      toast({ title: "Enter a discount", description: "Enter an amount greater than $0.", variant: "destructive" });
      return;
    }
    setAppliedDiscount({ code: null, label: "Discount", amount });
    setManualDiscountInput("");
  }

  return {
    serviceType, setServiceType, service, serviceLabel,
    bedrooms, setBedrooms, bathrooms, setBathrooms, sqm, setSqm, windows, setWindows, items, setItems, hours, setHours, bandIndex, setBandIndex,
    lineItems, setLineItems, updateItem,
    selectedExtras, setSelectedExtras, customExtras, setCustomExtras, addCustomExtra, extraQtys, setExtraQtys, extraQty,
    variableChoices, setVariableChoices, variableCustom, setVariableCustom, variableNumbers, setVariableNumbers, variableLines,
    serviceContext, selectedExtraDetails, extraLines, variableLineItems, allLines, totals,
    pricing, autoPrice, pricingSource,
    appliedDiscount, clearDiscount: () => setAppliedDiscount(null), seededHadDiscount: seededHadDiscount.current,
    couponInput, setCouponInput, manualDiscountInput, setManualDiscountInput, discountBusy, applyCoupon, applyManualDiscount,
  };
}

export type QuotePricingState = ReturnType<typeof useQuotePricing>;
