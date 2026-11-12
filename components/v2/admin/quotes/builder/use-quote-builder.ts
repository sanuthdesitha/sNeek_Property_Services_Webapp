"use client";

/**
 * The quote builder's whole state for the quote full page (create and edit).
 * Composes the pricing and checklist hooks and keeps the old builder's rules:
 * recipient (client / lead / new lead), service address, presentation
 * overrides, reference photos, auto-drafted notes, validity, and the create
 * (`POST /api/admin/quotes`) and save (`PATCH /api/admin/quotes/[id]`) bodies,
 * each followed by the discount route for the staged discount.
 *
 * Saves are explicit: the quote PATCH has no stale-write guard, so the page
 * does not autosave. `dirty` compares the save body with the last saved one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PricingVariable } from "@/lib/pricing/variables";
import type { CaseQuotePrefill } from "@/lib/cases/repair-quote";
import type { QuoteEditSeed } from "@/lib/quotes/quote-record";
import { buildEditSeed, type ClientOption, type LeadOption, type NewLeadDraft, type RecipientMode, type ReferenceImage, type ServiceOption } from "./model";
import { buildCreatePayload, buildEditPatch, buildQuoteMeta, discountRequestBody, type BuilderPayloadInput } from "./payload";
import { useQuotePricing } from "./use-pricing";
import { useQuoteChecklist } from "./use-checklist";

export type QuoteBuilderOptions = {
  leads: LeadOption[];
  clients: ClientOption[];
  services: ServiceOption[];
  gstEnabled: boolean;
  pricingVariables: PricingVariable[];
  editQuote?: QuoteEditSeed;
  casePrefill?: CaseQuotePrefill;
  recipientPrefill?: { clientId?: string; leadId?: string };
  /** Default send recipient (the client's or lead's email). */
  defaultRecipient?: string;
};

export type SaveResult = { ok: true; quoteId: string; marginWarning?: string | null; discountError?: string | null } | { ok: false; error: string };

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export function useQuoteBuilder(options: QuoteBuilderOptions) {
  const { editQuote, leads, clients, services } = options;
  const casePrefill = editQuote ? undefined : options.casePrefill;
  const recipientPrefill = editQuote ? undefined : options.recipientPrefill;
  const isEdit = Boolean(editQuote);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seed = useMemo(() => (editQuote ? buildEditSeed(editQuote, options.pricingVariables) : null), []);

  const pricing = useQuotePricing({
    seed,
    services,
    pricingVariables: options.pricingVariables,
    gstEnabled: options.gstEnabled,
    initialServiceType: seed?.serviceType ?? services[0]?.jobType ?? "AIRBNB_TURNOVER",
  });
  const checklist = useQuoteChecklist(pricing.serviceType, seed?.editOverride ?? null);

  const [recipientMode, setRecipientMode] = useState<RecipientMode>(seed?.recipientMode ?? (recipientPrefill?.leadId && !recipientPrefill?.clientId ? "lead" : "client"));
  const [clientId, setClientId] = useState(seed?.clientId ?? casePrefill?.client?.id ?? recipientPrefill?.clientId ?? "");
  const [leadId, setLeadId] = useState(seed?.leadId ?? recipientPrefill?.leadId ?? "");
  const [newLead, setNewLead] = useState<NewLeadDraft>({ name: "", email: "", phone: "", suburb: "" });
  const [recipientEmail, setRecipientEmail] = useState(options.defaultRecipient ?? "");
  const [frequency, setFrequency] = useState<string>(seed?.frequency ?? "one_off");
  const [serviceAddress, setServiceAddress] = useState(seed?.serviceAddress ?? casePrefill?.property?.address ?? "");
  const [serviceSuburb, setServiceSuburb] = useState(seed?.serviceSuburb ?? casePrefill?.property?.suburb ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? casePrefill?.description ?? "");
  const [notesTouched, setNotesTouched] = useState(isEdit || Boolean(casePrefill));
  const [validUntilDate, setValidUntilDate] = useState(seed?.validUntilDate ?? "");
  const [quoteHeading, setQuoteHeading] = useState(seed?.quoteHeading ?? casePrefill?.title ?? "");
  const [emailSubject, setEmailSubject] = useState(seed?.emailSubject ?? "");
  const [emailMessage, setEmailMessage] = useState(seed?.emailMessage ?? "");
  const [refImages, setRefImages] = useState<ReferenceImage[]>(seed?.refImages ?? casePrefill?.referenceImages ?? []);
  const [showAddOnPrices, setShowAddOnPrices] = useState(seed?.showAddOnPrices ?? false);
  const [saving, setSaving] = useState(false);

  function buildAutoNotes(): string {
    const sentences: string[] = [];
    const summary = checklist.checklist?.summary?.trim();
    if (summary) sentences.push(summary.replace(/\s+$/, ""));
    sentences.push(`${pricing.serviceLabel} for your property. This quote includes the standard ${pricing.serviceLabel.toLowerCase()} checklist (see the attached "What's included" list).`);
    const extraLabels = pricing.selectedExtraDetails.map((e) => e.label);
    if (extraLabels.length > 0) sentences.push(`Added on this quote: ${extraLabels.join(", ")}.`);
    if (validUntilDate) sentences.push(`This quote is valid until ${validUntilDate}.`);
    return sentences.join(" ");
  }

  useEffect(() => {
    if (notesTouched) return;
    setNotes(buildAutoNotes());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing.serviceType, pricing.serviceLabel, pricing.selectedExtraDetails, checklist.checklist, validUntilDate, notesTouched]);

  function applyLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    if (lead.serviceType && services.some((s) => s.jobType === lead.serviceType)) pricing.setServiceType(lead.serviceType);
    if (lead.bedrooms != null) pricing.setBedrooms(String(lead.bedrooms));
    if (lead.bathrooms != null) pricing.setBathrooms(String(lead.bathrooms));
    if (lead.suburb) setServiceSuburb((prev) => prev.trim() || String(lead.suburb));
    if (lead.email) setRecipientEmail(lead.email);
  }

  function applyClient(id: string) {
    setClientId(id);
    const client = clients.find((c) => c.id === id);
    if (!client) return;
    if (client.suburb) setServiceSuburb((prev) => prev.trim() || String(client.suburb));
    if (client.email) setRecipientEmail(client.email);
  }

  function recipientValid(): boolean {
    if (recipientMode === "client") return Boolean(clientId);
    if (recipientMode === "lead") return Boolean(leadId);
    return Boolean(newLead.name.trim() && newLead.email.trim());
  }

  const payloadInput: BuilderPayloadInput = {
    meta: buildQuoteMeta({
      model: pricing.service?.model,
      bedrooms: pricing.bedrooms,
      bathrooms: pricing.bathrooms,
      sqm: pricing.sqm,
      extras: pricing.selectedExtraDetails,
      extraQty: pricing.extraQty,
      checklistTouched: checklist.touched,
      editChecklist: checklist.editChecklist,
      quoteHeading,
      emailSubject,
      emailMessage,
      pricingSource: pricing.pricingSource,
    }),
    notes,
    serviceContext: pricing.serviceContext,
    refImages,
    showAddOnPrices,
    recipientMode,
    clientId,
    leadId,
    newLead,
    serviceType: pricing.serviceType,
    frequency,
    serviceAddress,
    serviceSuburb,
    lines: pricing.allLines,
    totals: pricing.totals,
    validUntilDate,
    fromCaseId: casePrefill?.caseId,
  };

  // Dirty tracking (edit mode): the save body plus the staged discount,
  // compared with the body captured once the checklist settled.
  const currentKey = JSON.stringify([buildEditPatch(payloadInput), pricing.appliedDiscount]);
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    if (baseline.current === null && !checklist.loading) baseline.current = currentKey;
  }, [checklist.loading, currentKey]);
  const dirty = isEdit && baseline.current !== null && baseline.current !== currentKey;

  function pricingProblem(): string | null {
    return pricing.allLines.length === 0 || pricing.totals.subtotal <= 0 ? "Calculate from the rate card, add line items, or pick extras." : null;
  }

  async function applyDiscount(quoteId: string): Promise<string | null> {
    const body = discountRequestBody(pricing.appliedDiscount, pricing.seededHadDiscount);
    if (!body) return null;
    try {
      const res = await fetch(`/api/admin/quotes/${quoteId}/discount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return null;
      const data = await readJson(res);
      return typeof data.error === "string" ? data.error : "The quote saved, but the discount couldn't be applied.";
    } catch {
      return "The quote saved, but the discount couldn't be applied.";
    }
  }

  /** Create (new page) or save (existing quote). Fields stay frozen while it runs; drafts survive a failure. */
  async function save(): Promise<SaveResult> {
    if (!isEdit && !recipientValid()) return { ok: false, error: "Choose a recipient: select a client or lead, or enter the new lead's name and email." };
    const problem = pricingProblem();
    if (problem) return { ok: false, error: problem };
    setSaving(true);
    try {
      const res = editQuote
        ? await fetch(`/api/admin/quotes/${editQuote.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildEditPatch(payloadInput)) })
        : await fetch("/api/admin/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildCreatePayload(payloadInput)) });
      const data = await readJson(res);
      if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "Could not save the quote." };
      const quoteId = editQuote?.id ?? String(data.id);
      const discountError = await applyDiscount(quoteId);
      baseline.current = currentKey;
      return { ok: true, quoteId, marginWarning: typeof data.marginWarning === "string" ? data.marginWarning : null, discountError };
    } catch {
      return { ok: false, error: "The save did not reach the server. Your changes are still here; try again." };
    } finally {
      setSaving(false);
    }
  }

  return {
    isEdit, casePrefill, pricing, checklist, serviceOptions: services,
    recipientMode, setRecipientMode, clientId, applyClient, leadId, applyLead, newLead, setNewLead, recipientEmail, setRecipientEmail,
    frequency, setFrequency, serviceAddress, setServiceAddress, serviceSuburb, setServiceSuburb,
    notes, setNotes: (value: string) => { setNotesTouched(true); setNotes(value); },
    regenerateNotes: () => { setNotesTouched(false); setNotes(buildAutoNotes()); },
    validUntilDate, setValidUntilDate, quoteHeading, setQuoteHeading, emailSubject, setEmailSubject, emailMessage, setEmailMessage,
    refImages, setRefImages, showAddOnPrices, setShowAddOnPrices,
    payloadInput, pricingProblem, dirty, saving, save,
  };
}

export type QuoteBuilderState = ReturnType<typeof useQuoteBuilder>;
