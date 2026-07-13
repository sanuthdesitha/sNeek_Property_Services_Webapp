"use client";

/**
 * ESTATE quote builder — v2-native replacement for the v1 NewQuoteForm.
 * Same endpoints and payloads:
 *   POST /api/admin/quotes/price            (auto price from rate card)
 *   POST /api/admin/quotes                  (create draft)
 *   POST /api/admin/quotes/[id]/send        (create & send)
 * Built entirely on the v2 primitives + estate-kit; no components/ui/* imports.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JobType } from "@prisma/client";
import {
  Check,
  Eye,
  ImagePlus,
  Link2,
  Loader2,
  ListChecks,
  Mail,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { calculateGstBreakdown, getGstDisplayLabel } from "@/lib/pricing/gst";
import { EXTRAS_BY_CATEGORY, EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";
import type { PricingSelections, PricingVariable } from "@/lib/pricing/variables";
import type { ServiceChecklist } from "@/lib/checklists/types";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESelect, EModal, ESwitch } from "@/components/v2/admin/estate-kit";

type LineItem = { label: string; unitPrice: number; qty: number; total: number };
type CustomExtra = { id: string; label: string; price: number; instructions: string };
type ReferenceImage = { key: string; url: string; label?: string };
type VariableLine = { label: string; amount: number };

/** Sentinel select value for the "Other…" free-typed option (allowCustom). */
const CUSTOM_OPTION = "__custom__";

/** Human hint for how an option adjusts the price ("+20%", "+$25", ""). */
function adjustHint(adjustType: string, adjustValue: number): string {
  if (adjustType === "none" || !adjustValue) return "";
  const sign = adjustValue > 0 ? "+" : "−";
  const abs = Math.abs(adjustValue);
  return adjustType === "percent" ? ` (${sign}${abs}%)` : ` (${sign}$${abs})`;
}

// Editable per-quote checklist working model (seeded from the service default).
type EditItem = { id: string; label: string; covered: boolean };
type EditSection = { id: string; title: string; items: EditItem[] };
type EditChecklist = { summary: string; sections: EditSection[]; notCovered: string[] };

let checklistUid = 0;
const nextUid = () => `ck-${Date.now().toString(36)}-${(checklistUid++).toString(36)}`;

/** Seed the editable model from a fetched service checklist. */
function editableFromChecklist(c: ServiceChecklist): EditChecklist {
  return {
    summary: c.summary ?? "",
    sections: c.sections.map((s, si) => ({
      id: s.id || `sec-${si}`,
      title: s.title,
      items: s.items.map((it, ii) => ({
        id: it.id || `it-${si}-${ii}`,
        label: it.label,
        covered: it.covered,
      })),
    })),
    notCovered: [...(c.notCovered ?? [])],
  };
}
interface Option {
  id: string;
  name: string;
  email: string;
}
interface ServiceOption {
  jobType: string;
  label: string;
  model: "ROOMS" | "AREA" | "WINDOWS" | "ITEMS" | "BANDS" | "HOURLY";
  itemLabel: string | null;
  unitLabel: string | null;
  bands: { label: string }[];
}
/** The stored quote reshaped for seeding the builder in edit mode. */
export interface QuoteEditSeed {
  id: string;
  status: string;
  serviceType: string;
  clientId: string | null;
  leadId: string | null;
  leadName?: string | null;
  serviceContext: Record<string, string | number | boolean> | null;
  referenceImages: ReferenceImage[];
  showAddOnPrices: boolean;
  lineItems: LineItem[];
  /** Raw notes including any [[META:{…}]] block. */
  notes: string;
  /** ISO string or null. */
  validUntil: string | null;
}

interface QuoteBuilderProps {
  leads: (Option & {
    serviceType?: JobType;
    bedrooms?: number | null;
    bathrooms?: number | null;
  })[];
  clients: Option[];
  services: ServiceOption[];
  gstEnabled: boolean;
  /** Admin-configured pricing variables (settings), rendered as selectors. */
  pricingVariables?: PricingVariable[];
  /** When present, the builder loads in "edit" mode: all state is seeded from
   *  this quote and the primary action becomes "Save changes" (PATCH). */
  editQuote?: QuoteEditSeed;
}

/** Pull + parse the [[META:{…}]] JSON block out of stored quote notes. */
function parseNotesMeta(notes: string | null | undefined): Record<string, any> | null {
  if (!notes) return null;
  const match = notes.match(/\[\[META:([\s\S]+?)\]\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, any>;
  } catch {
    return null;
  }
}

/** Strip the [[META]] block, leaving the human-facing prose notes. */
function stripNotesMeta(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes.replace(/\[\[META:([\s\S]+?)\]\]/, "").trim();
}

/** Rebuild the editable checklist model from a notes-META checklist override
 *  (exactly the shape the send route reads back — see checklistOverrideFromNotes). */
function editChecklistFromMeta(meta: Record<string, any> | null): EditChecklist | null {
  const ov = meta?.checklist;
  if (!ov || !Array.isArray(ov.sections)) return null;
  const sections: EditSection[] = ov.sections.map((s: any, si: number) => ({
    id: `sec-${si}`,
    title: typeof s?.title === "string" ? s.title : "",
    items: Array.isArray(s?.items)
      ? s.items
          .filter((it: any) => typeof it?.label === "string" && it.label.trim())
          .map((it: any, ii: number) => ({
            id: `it-${si}-${ii}`,
            label: String(it.label).trim(),
            covered: Boolean(it?.covered),
          }))
      : [],
  }));
  const notCovered = Array.isArray(ov.notCovered)
    ? ov.notCovered.filter((n: unknown): n is string => typeof n === "string")
    : [];
  return { summary: typeof ov.summary === "string" ? ov.summary : "", sections, notCovered };
}

/** Compute every seedable piece of builder state from a stored quote. Pure. */
function buildEditSeed(editQuote: QuoteEditSeed, pricingVariables: PricingVariable[]) {
  const meta = parseNotesMeta(editQuote.notes);

  // Dimensions live in the META block (only ROOMS/AREA models store them).
  const bedrooms = meta?.bedrooms != null ? String(meta.bedrooms) : "2";
  const bathrooms = meta?.bathrooms != null ? String(meta.bathrooms) : "1";
  const sqm = meta?.sqm != null ? String(meta.sqm) : "50";

  // Pricing-variable selections come from serviceContext (variable id → value).
  const variableChoices: Record<string, string> = {};
  const variableCustom: Record<string, string> = {};
  const variableNumbers: Record<string, string> = {};
  const ctx = editQuote.serviceContext ?? {};
  for (const variable of pricingVariables) {
    const val = ctx[variable.id];
    if (variable.kind === "number") {
      if (val != null) variableNumbers[variable.id] = String(val);
      continue;
    }
    const options = variable.options ?? [];
    const fallback = variable.defaultOptionId ?? options[0]?.id ?? "";
    if (val == null) {
      if (fallback) variableChoices[variable.id] = fallback;
      continue;
    }
    if (options.some((o) => o.id === val)) {
      variableChoices[variable.id] = String(val);
    } else if (variable.allowCustom) {
      variableChoices[variable.id] = CUSTOM_OPTION;
      variableCustom[variable.id] = String(val);
    } else if (fallback) {
      variableChoices[variable.id] = fallback;
    }
  }

  // Extras were appended LAST in the stored line items, one per META.extras entry
  // and in the same order — split them back out so the builder re-derives their
  // lines from the selection (and custom-extra prices are recovered from them).
  const extrasMeta: any[] = Array.isArray(meta?.extras) ? meta!.extras : [];
  const stored = editQuote.lineItems ?? [];
  const extraCount = Math.min(extrasMeta.length, stored.length);
  const extraSlice = extraCount > 0 ? stored.slice(stored.length - extraCount) : [];
  const baseLineItems = extraCount > 0 ? stored.slice(0, stored.length - extraCount) : stored.slice();

  const selectedExtras: string[] = [];
  const customExtras: CustomExtra[] = [];
  extrasMeta.forEach((raw, i) => {
    const id = typeof raw?.id === "string" ? raw.id : "";
    const label = typeof raw?.label === "string" ? raw.label : "";
    const instructions = typeof raw?.instructions === "string" ? raw.instructions : "";
    const line = extraSlice[i];
    const price = line ? Number(line.unitPrice ?? line.total ?? 0) || 0 : 0;
    if (id && EXTRAS_BY_ID[id]) {
      selectedExtras.push(id);
    } else if (id || label) {
      customExtras.push({ id: id || `custom:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label, price, instructions });
    }
  });

  const recipientMode: RecipientMode = editQuote.clientId ? "client" : editQuote.leadId ? "lead" : "new";

  return {
    recipientMode,
    clientId: editQuote.clientId ?? "",
    leadId: editQuote.leadId ?? "",
    serviceType: editQuote.serviceType,
    bedrooms,
    bathrooms,
    sqm,
    variableChoices,
    variableCustom,
    variableNumbers,
    selectedExtras,
    customExtras,
    lineItems: baseLineItems,
    refImages: editQuote.referenceImages ?? [],
    showAddOnPrices: Boolean(editQuote.showAddOnPrices),
    notes: stripNotesMeta(editQuote.notes),
    validUntilDate: editQuote.validUntil ? editQuote.validUntil.slice(0, 10) : "",
    editOverride: editChecklistFromMeta(meta),
  };
}

type RecipientMode = "client" | "lead" | "new";

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export function QuoteBuilder({
  leads,
  clients,
  services,
  gstEnabled,
  pricingVariables = [],
  editQuote,
}: QuoteBuilderProps) {
  const router = useRouter();

  const isEdit = Boolean(editQuote);
  // Seed once from the stored quote in edit mode (deterministic from props).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seed = useMemo(() => (editQuote ? buildEditSeed(editQuote, pricingVariables) : null), []);

  const [recipientMode, setRecipientMode] = useState<RecipientMode>(seed?.recipientMode ?? "client");
  const [clientId, setClientId] = useState(seed?.clientId ?? "");
  const [leadId, setLeadId] = useState(seed?.leadId ?? "");
  const [newLead, setNewLead] = useState({ name: "", email: "", phone: "", suburb: "" });

  const [serviceType, setServiceType] = useState<string>(
    seed?.serviceType ?? services[0]?.jobType ?? "AIRBNB_TURNOVER",
  );
  const [bedrooms, setBedrooms] = useState(seed?.bedrooms ?? "2");
  const [bathrooms, setBathrooms] = useState(seed?.bathrooms ?? "1");
  const [sqm, setSqm] = useState(seed?.sqm ?? "50");
  const [windows, setWindows] = useState("10");
  const [items, setItems] = useState("3");
  const [hours, setHours] = useState("3");
  const [bandIndex, setBandIndex] = useState("0");

  const [lineItems, setLineItems] = useState<LineItem[]>(seed?.lineItems ?? []);
  const [selectedExtras, setSelectedExtras] = useState<string[]>(seed?.selectedExtras ?? []);
  const [customExtras, setCustomExtras] = useState<CustomExtra[]>(seed?.customExtras ?? []);
  const [customLabel, setCustomLabel] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [pricing, setPricing] = useState(false);
  const [notes, setNotes] = useState(seed?.notes ?? "");
  // In edit mode the seeded prose notes must survive (don't let auto-draft run).
  const [notesTouched, setNotesTouched] = useState(isEdit);
  const [validUntilDate, setValidUntilDate] = useState(seed?.validUntilDate ?? "");
  const [saving, setSaving] = useState(false);

  // ── Pricing variables (settings-driven) ──────────────────────────────────
  // Select/boolean kinds hold an option id (or CUSTOM_OPTION when "Other…"),
  // number kinds hold a string the admin types. Defaults are preselected.
  const [variableChoices, setVariableChoices] = useState<Record<string, string>>(() => {
    if (seed) return seed.variableChoices;
    const initial: Record<string, string> = {};
    for (const variable of pricingVariables) {
      if (variable.kind === "number") continue;
      const fallback = variable.defaultOptionId ?? variable.options?.[0]?.id ?? "";
      if (fallback) initial[variable.id] = fallback;
    }
    return initial;
  });
  const [variableCustom, setVariableCustom] = useState<Record<string, string>>(seed?.variableCustom ?? {});
  const [variableNumbers, setVariableNumbers] = useState<Record<string, string>>(seed?.variableNumbers ?? {});
  const [variableLines, setVariableLines] = useState<VariableLine[]>([]);

  // Effective serviceContext payload: variable id → option id / custom string /
  // numeric quantity. Empty custom "Other…" entries and blank numbers are omitted.
  const serviceContext = useMemo<PricingSelections>(() => {
    const out: PricingSelections = {};
    for (const variable of pricingVariables) {
      if (variable.kind === "number") {
        const raw = (variableNumbers[variable.id] ?? "").trim();
        if (!raw) continue;
        const qty = Number(raw);
        if (!Number.isFinite(qty) || qty === 0) continue;
        out[variable.id] = qty;
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

  // ── Client reference photos ───────────────────────────────────────────────
  const [refImages, setRefImages] = useState<ReferenceImage[]>(seed?.refImages ?? []);
  const [uploadingRefs, setUploadingRefs] = useState(false);
  const refFileInput = useRef<HTMLInputElement | null>(null);

  // ── Add-on price visibility (client-facing) ───────────────────────────────
  const [showAddOnPrices, setShowAddOnPrices] = useState(seed?.showAddOnPrices ?? false);

  // "What's included" checklist for the selected service (base default, fetched).
  const [checklist, setChecklist] = useState<ServiceChecklist | null>(null);
  const [checklistLoading, setChecklistLoading] = useState(false);

  // Per-quote editable override, seeded from the fetched base. `checklistTouched`
  // gates whether an override is written into the notes META (backward-compat:
  // untouched → no override → send route uses the base template).
  const [editChecklist, setEditChecklist] = useState<EditChecklist | null>(null);
  const [checklistTouched, setChecklistTouched] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState(false);
  const [newItemLabels, setNewItemLabels] = useState<Record<string, string>>({});
  const [newExclusion, setNewExclusion] = useState("");

  const service = useMemo(
    () => services.find((s) => s.jobType === serviceType) ?? services[0],
    [services, serviceType],
  );

  const serviceLabel = service?.label ?? String(serviceType).replace(/_/g, " ");

  // Selected extras resolved to a common shape — catalog picks + custom special
  // requests. Custom ids (e.g. "custom:deep-fridge") are NOT in EXTRAS_BY_ID, so
  // they are carried through their own store rather than being dropped.
  const selectedExtraDetails = useMemo(
    () => [
      ...selectedExtras
        .map((id) => EXTRAS_BY_ID[id])
        .filter(Boolean)
        .map((e) => ({ id: e.id, label: e.label, price: e.price, instructions: e.instructions })),
      ...customExtras.map((c) => ({ id: c.id, label: c.label, price: c.price, instructions: c.instructions })),
    ],
    [selectedExtras, customExtras],
  );

  const extraLines = useMemo<LineItem[]>(
    () => selectedExtraDetails.map((e) => ({ label: e.label, unitPrice: e.price, qty: 1, total: e.price })),
    [selectedExtraDetails],
  );
  // Pricing-variable adjustments as quote line items (kept separate from the
  // hand-editable rows so re-pricing can replace them cleanly).
  const variableLineItems = useMemo<LineItem[]>(
    () => variableLines.map((l) => ({ label: l.label, unitPrice: l.amount, qty: 1, total: l.amount })),
    [variableLines],
  );
  const allLines = useMemo(
    () => [...lineItems, ...variableLineItems, ...extraLines],
    [lineItems, variableLineItems, extraLines],
  );

  // In edit mode, apply the reconstructed checklist override exactly once — after
  // the base template has loaded (so switching service later still resets to base).
  const appliedEditOverride = useRef(false);

  // Seed / reset the editable model whenever the base checklist changes (i.e. on
  // service switch). A fresh base clears any per-quote edits.
  useEffect(() => {
    if (seed?.editOverride && !appliedEditOverride.current && checklist) {
      appliedEditOverride.current = true;
      setEditChecklist(seed.editOverride);
      setChecklistTouched(true);
      setNewItemLabels({});
      setNewExclusion("");
      return;
    }
    setEditChecklist(checklist ? editableFromChecklist(checklist) : null);
    setChecklistTouched(false);
    setNewItemLabels({});
    setNewExclusion("");
  }, [checklist]);

  // Included / not-included preview derived from the EDITABLE model — this panel
  // is exactly what the client will receive, reflecting every edit live.
  const includedItems = useMemo(
    () =>
      editChecklist
        ? editChecklist.sections.flatMap((s) => s.items.filter((i) => i.covered).map((i) => i.label))
        : [],
    [editChecklist],
  );
  const notIncludedItems = useMemo(() => {
    if (!editChecklist) return [];
    const excludedItems = editChecklist.sections.flatMap((s) =>
      s.items.filter((i) => !i.covered).map((i) => i.label),
    );
    return [...editChecklist.notCovered, ...excludedItems];
  }, [editChecklist]);

  // ─── Checklist edit helpers (all flag the override as touched) ───────────────
  function touchChecklist(next: EditChecklist) {
    setEditChecklist(next);
    setChecklistTouched(true);
  }
  function toggleItem(sid: string, iid: string) {
    if (!editChecklist) return;
    touchChecklist({
      ...editChecklist,
      sections: editChecklist.sections.map((s) =>
        s.id !== sid
          ? s
          : { ...s, items: s.items.map((it) => (it.id !== iid ? it : { ...it, covered: !it.covered })) },
      ),
    });
  }
  function renameItem(sid: string, iid: string, label: string) {
    if (!editChecklist) return;
    touchChecklist({
      ...editChecklist,
      sections: editChecklist.sections.map((s) =>
        s.id !== sid ? s : { ...s, items: s.items.map((it) => (it.id !== iid ? it : { ...it, label })) },
      ),
    });
  }
  function removeItem(sid: string, iid: string) {
    if (!editChecklist) return;
    touchChecklist({
      ...editChecklist,
      sections: editChecklist.sections.map((s) =>
        s.id !== sid ? s : { ...s, items: s.items.filter((it) => it.id !== iid) },
      ),
    });
  }
  function addItem(sid: string) {
    if (!editChecklist) return;
    const label = (newItemLabels[sid] ?? "").trim();
    if (!label) return;
    touchChecklist({
      ...editChecklist,
      sections: editChecklist.sections.map((s) =>
        s.id !== sid ? s : { ...s, items: [...s.items, { id: nextUid(), label, covered: true }] },
      ),
    });
    setNewItemLabels((prev) => ({ ...prev, [sid]: "" }));
  }
  function updateSummary(summary: string) {
    if (!editChecklist) return;
    touchChecklist({ ...editChecklist, summary });
  }
  function addExclusion() {
    if (!editChecklist) return;
    const line = newExclusion.trim();
    if (!line) return;
    touchChecklist({ ...editChecklist, notCovered: [...editChecklist.notCovered, line] });
    setNewExclusion("");
  }
  function updateExclusion(idx: number, value: string) {
    if (!editChecklist) return;
    touchChecklist({
      ...editChecklist,
      notCovered: editChecklist.notCovered.map((n, i) => (i === idx ? value : n)),
    });
  }
  function removeExclusion(idx: number) {
    if (!editChecklist) return;
    touchChecklist({ ...editChecklist, notCovered: editChecklist.notCovered.filter((_, i) => i !== idx) });
  }
  function resetChecklist() {
    setEditChecklist(checklist ? editableFromChecklist(checklist) : null);
    setChecklistTouched(false);
    setNewItemLabels({});
    setNewExclusion("");
  }

  // Fetch the checklist whenever the service changes (admin-gated endpoint).
  useEffect(() => {
    let cancelled = false;
    setChecklistLoading(true);
    setChecklist(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/checklists?jobType=${encodeURIComponent(serviceType)}`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setChecklist((body?.checklist as ServiceChecklist | null) ?? null);
      } catch {
        // preview is non-essential — never block the builder
      } finally {
        if (!cancelled) setChecklistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceType]);

  // Human-readable, client-facing notes auto-drafted from the service + checklist
  // summary + selected extras. Prose only — the [[META]] block is appended
  // separately in buildPayload() and is never part of this text.
  function buildAutoNotes() {
    const sentences: string[] = [];
    if (checklist?.summary?.trim()) {
      sentences.push(checklist.summary.trim().replace(/\s+$/, ""));
    }
    sentences.push(
      `${serviceLabel} for your property. This quote includes the standard ${serviceLabel.toLowerCase()} checklist (see the attached "What's included" list).`,
    );
    const extraLabels = selectedExtraDetails.map((e) => e.label);
    if (extraLabels.length > 0) {
      sentences.push(`Added on this quote: ${extraLabels.join(", ")}.`);
    }
    if (validUntilDate) {
      sentences.push(`This quote is valid until ${validUntilDate}.`);
    }
    return sentences.join(" ");
  }

  // Keep notes in sync with the auto-draft until the admin edits them by hand.
  useEffect(() => {
    if (notesTouched) return;
    setNotes(buildAutoNotes());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, serviceLabel, selectedExtraDetails, checklist, validUntilDate, notesTouched]);

  function addCustomRequest() {
    const label = customLabel.trim();
    if (!label) {
      toast({ title: "Add a label", description: "Describe the special request first.", variant: "destructive" });
      return;
    }
    const slug =
      label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      Math.random().toString(36).slice(2, 8);
    const id = `custom:${slug}-${Date.now().toString(36)}`;
    setCustomExtras((prev) => [...prev, { id, label, price: Number(customPrice) || 0, instructions: customInstructions.trim() }]);
    setCustomLabel("");
    setCustomPrice("");
    setCustomInstructions("");
  }

  const { subtotal, gstAmount, totalAmount } = useMemo(() => {
    const sum = allLines.reduce((acc, li) => acc + (Number(li.total) || 0), 0);
    return calculateGstBreakdown(Math.max(0, Number(sum.toFixed(2))), { gstEnabled });
  }, [allLines, gstEnabled]);
  const gstLabel = useMemo(() => getGstDisplayLabel({ gstEnabled }), [gstEnabled]);

  function applyLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    if (lead.serviceType && services.some((s) => s.jobType === lead.serviceType)) {
      setServiceType(lead.serviceType);
    }
    if (lead.bedrooms != null) setBedrooms(String(lead.bedrooms));
    if (lead.bathrooms != null) setBathrooms(String(lead.bathrooms));
  }

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

  // Track whether the rate card has priced this quote at least once — pricing
  // variables then re-price live (debounced) as selections change.
  const [hasAutoPriced, setHasAutoPriced] = useState(false);

  async function autoPrice(opts: { silent?: boolean } = {}) {
    setPricing(true);
    try {
      const res = await fetch("/api/admin/quotes/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...priceInputs(),
          serviceContext: Object.keys(serviceContext).length > 0 ? serviceContext : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not price this quote.");
      if (body.requiresManualQuote) {
        if (!opts.silent) {
          toast({ title: "Manual quote needed", description: body.message ?? "Add line items by hand." });
        }
        return;
      }
      const combined: LineItem[] = Array.isArray(body.result?.lineItems) ? body.result.lineItems : [];
      const returnedVariableLines: VariableLine[] = Array.isArray(body.result?.variableLines)
        ? body.result.variableLines
        : [];
      if (combined.length === 0) {
        if (!opts.silent) {
          toast({ title: "No price returned", description: "Add line items manually.", variant: "destructive" });
        }
        return;
      }
      // The endpoint returns base line items + variable adjustment lines
      // appended; split them back apart so adjustments stay live-replaceable.
      const baseCount = Math.max(0, combined.length - returnedVariableLines.length);
      setLineItems(
        combined.slice(0, baseCount).map((i) => ({
          label: i.label,
          unitPrice: Number(i.unitPrice),
          qty: Number(i.qty),
          total: Number(i.total),
        })),
      );
      setVariableLines(
        returnedVariableLines.map((l) => ({ label: String(l.label), amount: Number(l.amount) || 0 })),
      );
      setHasAutoPriced(true);
      if (!opts.silent) {
        toast({ title: "Priced from rate card", description: `${combined.length} line item(s) added.` });
      }
    } catch (err: any) {
      if (!opts.silent) toast({ title: "Pricing failed", description: err.message, variant: "destructive" });
    } finally {
      setPricing(false);
    }
  }

  // Live totals: once priced, changing a pricing variable re-prices quietly.
  const serviceContextKey = JSON.stringify(serviceContext);
  useEffect(() => {
    if (!hasAutoPriced) return;
    const timer = setTimeout(() => {
      autoPrice({ silent: true });
    }, 450);
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

  function recipientValid(): boolean {
    if (recipientMode === "client") return Boolean(clientId);
    if (recipientMode === "lead") return Boolean(leadId);
    return Boolean(newLead.name.trim() && newLead.email.trim());
  }

  function buildMeta() {
    const m = service?.model;
    const base: Record<string, unknown> = {};
    if (m === "ROOMS") {
      base.bedrooms = Number(bedrooms) || 0;
      base.bathrooms = Number(bathrooms) || 0;
      if (Number(sqm) > 0) base.sqm = Number(sqm) || 0;
    } else if (m === "AREA") {
      base.sqm = Number(sqm) || 0;
    }
    base.extras = selectedExtraDetails.map((e) => ({
      id: e.id,
      label: e.label,
      instructions: e.instructions,
    }));
    // Per-quote checklist override — only when the admin actually edited it, so
    // untouched quotes stay on the base template (backward-compatible).
    if (checklistTouched && editChecklist) {
      base.checklist = {
        summary: editChecklist.summary.trim() || undefined,
        sections: editChecklist.sections.map((s) => ({
          title: s.title,
          items: s.items
            .filter((it) => it.label.trim())
            .map((it) => ({ label: it.label.trim(), covered: it.covered })),
        })),
        notCovered: editChecklist.notCovered.map((n) => n.trim()).filter(Boolean),
      };
    }
    return base;
  }

  async function uploadReferenceImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingRefs(true);
    try {
      const uploaded: ReferenceImage[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "quote-references");
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.url) throw new Error(body?.error ?? `Could not upload ${file.name}.`);
        uploaded.push({ key: String(body.key ?? body.url), url: String(body.url) });
      }
      setRefImages((prev) => [...prev, ...uploaded].slice(0, 12));
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingRefs(false);
      if (refFileInput.current) refFileInput.current.value = "";
    }
  }

  function buildPayload() {
    return {
      serviceContext: Object.keys(serviceContext).length > 0 ? serviceContext : undefined,
      referenceImages:
        refImages.length > 0
          ? refImages.map((r) => ({ key: r.key, url: r.url, label: r.label?.trim() || undefined }))
          : undefined,
      showAddOnPrices,
      clientId: recipientMode === "client" ? clientId : undefined,
      leadId: recipientMode === "lead" ? leadId : undefined,
      newLead:
        recipientMode === "new"
          ? {
              name: newLead.name.trim(),
              email: newLead.email.trim(),
              phone: newLead.phone.trim() || undefined,
              suburb: newLead.suburb.trim() || undefined,
            }
          : undefined,
      serviceType,
      lineItems: allLines,
      subtotal,
      gstAmount,
      totalAmount,
      notes:
        [notes.trim(), `[[META:${JSON.stringify(buildMeta())}]]`].filter(Boolean).join("\n") || undefined,
      validUntil: validUntilDate ? new Date(`${validUntilDate}T23:59:59`).toISOString() : undefined,
    };
  }

  // Draft preview — same render endpoint v1's /admin/quotes/preview download
  // uses (POST /api/admin/quotes/preview-pdf with the create payload); the
  // returned blob (PDF, or HTML fallback) is shown inline in a modal iframe.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openPreview() {
    if (allLines.length === 0 || subtotal <= 0) {
      toast({
        title: "Add pricing first",
        description: "Calculate from the rate card, add line items, or pick extras.",
        variant: "destructive",
      });
      return;
    }
    setPreviewing(true);
    try {
      // Recipient is irrelevant to the rendered preview (the endpoint renders
      // client/lead as empty), so strip it — this also allows previewing
      // before a recipient is chosen.
      const { clientId: _c, leadId: _l, newLead: _n, ...payload } = buildPayload();
      const res = await fetch("/api/admin/quotes/preview-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not render the quote preview.");
      }
      const blob = await res.blob();
      setPreviewUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return window.URL.createObjectURL(blob);
      });
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  function closePreview() {
    setPreviewUrl((prev) => {
      if (prev) window.URL.revokeObjectURL(prev);
      return null;
    });
  }

  // ── Email preview before sending (save & send path) ──────────────────────
  type EmailPreview = {
    quoteId: string;
    subject: string;
    html: string;
    attachments: Array<{ filename: string; size?: number }>;
    publicUrl?: string;
    recipients: string[];
  };
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [sendingNow, setSendingNow] = useState(false);

  async function confirmSend() {
    if (!emailPreview) return;
    setSendingNow(true);
    try {
      const res = await fetch(`/api/admin/quotes/${emailPreview.quoteId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the quote.");
      toast({
        title: "Quote sent",
        description: `Emailed with ${Array.isArray(body.attachments) ? body.attachments.length : 0} attachment(s).`,
      });
      setEmailPreview(null);
      router.push("/v2/admin/quotes");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    } finally {
      setSendingNow(false);
    }
  }

  function cancelSend() {
    const quoteId = emailPreview?.quoteId;
    setEmailPreview(null);
    toast({ title: "Saved as draft", description: "The quote was created but not sent." });
    router.push(quoteId ? `/v2/admin/quotes/${quoteId}` : "/v2/admin/quotes");
    router.refresh();
  }

  async function submit(send: boolean) {
    if (!recipientValid()) {
      toast({
        title: "Choose a recipient",
        description: "Select a client/lead or enter new lead details.",
        variant: "destructive",
      });
      return;
    }
    if (allLines.length === 0 || subtotal <= 0) {
      toast({
        title: "Add pricing",
        description: "Calculate from the rate card, add line items, or pick extras.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const quote = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(quote.error ?? "Failed to create quote.");
      if (quote.marginWarning) {
        toast({ title: "Margin warning", description: String(quote.marginWarning) });
      }

      if (send) {
        // Render the exact email (body + attachments + public link) WITHOUT
        // sending; the admin confirms from the preview modal.
        const previewRes = await fetch(`/api/admin/quotes/${quote.id}/send?preview=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preview: true }),
        });
        const previewBody = await previewRes.json().catch(() => ({}));
        if (!previewRes.ok) {
          toast({
            title: "Quote created, but the email preview failed",
            description: previewBody.error ?? "Open the quote to send it.",
            variant: "destructive",
          });
          router.push(`/v2/admin/quotes/${quote.id}`);
          router.refresh();
          return;
        }
        setEmailPreview({
          quoteId: quote.id,
          subject: String(previewBody.subject ?? ""),
          html: String(previewBody.html ?? ""),
          attachments: Array.isArray(previewBody.attachments) ? previewBody.attachments : [],
          publicUrl: typeof previewBody.publicUrl === "string" ? previewBody.publicUrl : undefined,
          recipients: Array.isArray(previewBody.recipients) ? previewBody.recipients : [],
        });
        return; // stay on the page — the modal takes it from here
      }

      toast({ title: "Quote created", description: "Saved as a draft." });
      router.push("/v2/admin/quotes");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Could not create quote", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ── Edit mode: PATCH the full payload back onto the existing quote ─────────
  function buildEditPatch() {
    return {
      serviceType,
      clientId: recipientMode === "client" ? clientId || null : null,
      lineItems: allLines,
      subtotal,
      gstAmount,
      totalAmount,
      notes: [notes.trim(), `[[META:${JSON.stringify(buildMeta())}]]`].filter(Boolean).join("\n") || null,
      serviceContext: Object.keys(serviceContext).length > 0 ? serviceContext : null,
      referenceImages:
        refImages.length > 0
          ? refImages.map((r) => ({ key: r.key, url: r.url, label: r.label?.trim() || undefined }))
          : null,
      showAddOnPrices,
      validUntil: validUntilDate ? new Date(`${validUntilDate}T23:59:59`).toISOString() : null,
    };
  }

  async function saveEdit() {
    if (!editQuote) return;
    if (allLines.length === 0 || subtotal <= 0) {
      toast({
        title: "Add pricing",
        description: "Calculate from the rate card, add line items, or pick extras.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/quotes/${editQuote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEditPatch()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save changes.");
      toast({ title: "Quote updated", description: "Your changes were saved." });
      router.push(`/v2/admin/quotes/${editQuote.id}`);
      router.refresh();
    } catch (err: any) {
      toast({ title: "Could not save changes", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Inline draft preview — exact render the recipient will receive */}
      <EModal open={Boolean(previewUrl)} onClose={closePreview} eyebrow="Quotes" title="Quote preview" size="full">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="Quote preview"
            className="h-[70vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white"
          />
        ) : null}
      </EModal>

      {/* Email preview — exact email + attachments, confirmed before sending */}
      <EModal
        open={Boolean(emailPreview)}
        onClose={cancelSend}
        eyebrow="Quotes"
        title="Review before sending"
        size="full"
      >
        {emailPreview ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <EEyebrow>To</EEyebrow>
                <p className="mt-1 text-[0.8125rem]">
                  {emailPreview.recipients.length > 0 ? emailPreview.recipients.join(", ") : "No recipient on file"}
                </p>
                <EEyebrow className="mt-3">Subject</EEyebrow>
                <p className="mt-1 text-[0.8125rem]">{emailPreview.subject}</p>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <EEyebrow className="flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3" /> Attachments
                </EEyebrow>
                {emailPreview.attachments.length === 0 ? (
                  <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">None</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {emailPreview.attachments.map((a, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                        <span className="min-w-0 truncate">{a.filename}</span>
                        {typeof a.size === "number" ? (
                          <span className="e-tnum shrink-0 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                            {(a.size / 1024).toFixed(0)} KB
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {emailPreview.publicUrl ? (
                  <p className="mt-3 flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <Link2 className="h-3 w-3 shrink-0 text-[hsl(var(--e-gold-ink))]" />
                    <span className="min-w-0 truncate">{emailPreview.publicUrl}</span>
                  </p>
                ) : null}
              </div>
            </div>
            <iframe
              srcDoc={emailPreview.html}
              sandbox=""
              title="Quote email preview"
              className="h-[52vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <EButton variant="outline" onClick={cancelSend} disabled={sendingNow}>
                Keep as draft
              </EButton>
              <EButton variant="gold" onClick={confirmSend} disabled={sendingNow}>
                {sendingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {sendingNow ? "Sending…" : "Send now"}
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>

      {/* Recipient */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Recipient</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["client", "Existing client"],
                ["lead", "Existing lead"],
                ["new", "New lead"],
              ] as const
            ).map(([m, label]) => (
              <EButton
                key={m}
                type="button"
                size="sm"
                variant={recipientMode === m ? "primary" : "outline"}
                onClick={() => setRecipientMode(m)}
              >
                {label}
              </EButton>
            ))}
          </div>
          {recipientMode === "client" ? (
            <EField label="Client">
              <ESelect value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? ` — ${c.email}` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : recipientMode === "lead" ? (
            <EField label="Lead">
              <ESelect value={leadId} onChange={(e) => applyLead(e.target.value)}>
                <option value="">Select a lead…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {l.email}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Name">
                <EInput value={newLead.name} onChange={(e) => setNewLead({ ...newLead, name: e.target.value })} />
              </EField>
              <EField label="Email">
                <EInput
                  type="email"
                  value={newLead.email}
                  onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                />
              </EField>
              <EField label="Phone">
                <EInput value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} />
              </EField>
              <EField label="Suburb">
                <EInput
                  value={newLead.suburb}
                  onChange={(e) => setNewLead({ ...newLead, suburb: e.target.value })}
                />
              </EField>
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Service + auto pricing */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Service &amp; pricing</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <EField label="Service">
              <ESelect value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                {services.map((s) => (
                  <option key={s.jobType} value={s.jobType}>
                    {s.label}
                  </option>
                ))}
              </ESelect>
            </EField>

            {service?.model === "ROOMS" ? (
              <>
                <EField label="Bedrooms">
                  <EInput type="number" min="0" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
                </EField>
                <EField label="Bathrooms">
                  <EInput type="number" min="0" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
                </EField>
                <EField label="Floor area (sqm)">
                  <EInput type="number" min="0" value={sqm} onChange={(e) => setSqm(e.target.value)} />
                </EField>
              </>
            ) : null}
            {service?.model === "AREA" ? (
              <EField label={`Area (${service.unitLabel ?? "sqm"})`}>
                <EInput type="number" min="0" value={sqm} onChange={(e) => setSqm(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "WINDOWS" ? (
              <EField label="Number of windows">
                <EInput type="number" min="0" value={windows} onChange={(e) => setWindows(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "ITEMS" ? (
              <EField label={`Number of ${service.itemLabel ?? "item"}s`}>
                <EInput type="number" min="0" value={items} onChange={(e) => setItems(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "HOURLY" ? (
              <EField label="Hours">
                <EInput type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
              </EField>
            ) : null}
            {service?.model === "BANDS" ? (
              <EField label="Size">
                <ESelect value={bandIndex} onChange={(e) => setBandIndex(e.target.value)}>
                  {(service.bands ?? []).map((b, i) => (
                    <option key={i} value={String(i)}>
                      {b.label}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : null}
          </div>

          <EButton type="button" onClick={() => autoPrice()} disabled={pricing}>
            {pricing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Calculate from rate card
          </EButton>
        </ECardBody>
      </ECard>

      {/* Pricing variables — settings-driven adjustments (condition, zone, …) */}
      {pricingVariables.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Pricing variables</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Property condition, location, parking and access — adjustments update the total live after pricing
              from the rate card.
            </p>
          </ECardHeader>
          <ECardBody className="pt-0">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pricingVariables.map((variable) => {
                if (variable.kind === "number") {
                  return (
                    <EField
                      key={variable.id}
                      label={variable.unitLabel ? `${variable.label} (${variable.unitLabel})` : variable.label}
                      hint={variable.note}
                    >
                      <EInput
                        type="number"
                        step="any"
                        value={variableNumbers[variable.id] ?? ""}
                        placeholder="0"
                        onChange={(e) =>
                          setVariableNumbers((prev) => ({ ...prev, [variable.id]: e.target.value }))
                        }
                      />
                    </EField>
                  );
                }
                const options = variable.options ?? [];
                const choice = variableChoices[variable.id] ?? "";
                return (
                  <EField key={variable.id} label={variable.label} hint={variable.note}>
                    <div className="space-y-2">
                      <ESelect
                        value={choice}
                        onChange={(e) =>
                          setVariableChoices((prev) => ({ ...prev, [variable.id]: e.target.value }))
                        }
                      >
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                            {adjustHint(option.adjustType, option.adjustValue)}
                          </option>
                        ))}
                        {variable.allowCustom ? <option value={CUSTOM_OPTION}>Other…</option> : null}
                      </ESelect>
                      {variable.allowCustom && choice === CUSTOM_OPTION ? (
                        <EInput
                          value={variableCustom[variable.id] ?? ""}
                          placeholder="Type the custom value…"
                          onChange={(e) =>
                            setVariableCustom((prev) => ({ ...prev, [variable.id]: e.target.value }))
                          }
                        />
                      ) : null}
                    </div>
                  </EField>
                );
              })}
            </div>
            {variableLines.length > 0 ? (
              <div className="mt-4 space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                <EEyebrow>Adjustments applied</EEyebrow>
                {variableLines.map((line, i) => (
                  <div key={i} className="flex items-center justify-between text-[0.8125rem]">
                    <span className="text-[hsl(var(--e-text-secondary))]">{line.label}</span>
                    <span className="e-tnum">{money(line.amount)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Extras / add-ons — grouped by category */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Extras / add-ons</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Added to the price and carried into the job form as &quot;Additionals&quot; so cleaners see exactly what
            extra work was quoted.
          </p>
          <div className="pt-2">
            <ESwitch
              checked={showAddOnPrices}
              onCheckedChange={setShowAddOnPrices}
              label={
                <>
                  Show add-on prices to client
                  <span className="ml-1 text-[hsl(var(--e-text-faint))]">
                    (off = the attached add-on list shows &quot;on request&quot;)
                  </span>
                </>
              }
            />
          </div>
        </ECardHeader>
        <ECardBody className="space-y-5 pt-0">
          {EXTRAS_BY_CATEGORY.map((group) => (
            <div key={group.id} className="space-y-2">
              <EEyebrow>{group.label}</EEyebrow>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.options.map((e) => {
                  const checked = selectedExtras.includes(e.id);
                  return (
                    <label
                      key={e.id}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-[var(--e-radius)] border p-2.5 text-[0.8125rem] transition-colors ${
                        checked
                          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-gold-soft))]"
                          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                          checked={checked}
                          onChange={(ev) =>
                            setSelectedExtras((prev) =>
                              ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id),
                            )
                          }
                        />
                        {e.label}
                      </span>
                      <span className="e-tnum shrink-0 text-[hsl(var(--e-muted-foreground))]">${e.price}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Custom "special request" line */}
          <div className="space-y-3 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] p-3">
            <EEyebrow>Special request</EEyebrow>
            <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
              <EInput
                value={customLabel}
                placeholder="e.g. Deep-clean garden shed"
                onChange={(e) => setCustomLabel(e.target.value)}
              />
              <EInput
                type="number"
                step="0.01"
                min="0"
                value={customPrice}
                placeholder="Price"
                onChange={(e) => setCustomPrice(e.target.value)}
              />
              <EButton type="button" variant="outline" onClick={addCustomRequest}>
                <Plus className="h-4 w-4" /> Add request
              </EButton>
            </div>
            <EInput
              value={customInstructions}
              placeholder="Instructions for the cleaner (optional)"
              onChange={(e) => setCustomInstructions(e.target.value)}
            />
            {customExtras.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                {customExtras.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2 text-[0.8125rem]"
                  >
                    <span className="min-w-0 truncate">
                      {c.label}
                      {c.instructions ? (
                        <span className="text-[hsl(var(--e-muted-foreground))]"> — {c.instructions}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{money(c.price)}</span>
                      <EButton
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setCustomExtras((prev) => prev.filter((x) => x.id !== c.id))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--e-danger))]" />
                      </EButton>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </ECardBody>
      </ECard>

      {/* Client reference photos — attached to the quote email as images */}
      <ECard>
        <ECardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <ECardTitle>Client reference photos</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Optional photos (the property, problem areas, examples) — attached to the quote email and shown on
              the quote.
            </p>
          </div>
          <EButton
            type="button"
            size="sm"
            variant="outline"
            onClick={() => refFileInput.current?.click()}
            disabled={uploadingRefs}
          >
            {uploadingRefs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploadingRefs ? "Uploading…" : "Add photos"}
          </EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          <input
            ref={refFileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => uploadReferenceImages(e.target.files)}
          />
          {refImages.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No reference photos added.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {refImages.map((img, idx) => (
                <div
                  key={img.key}
                  className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2"
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.label || `Reference ${idx + 1}`}
                      className="h-28 w-full rounded-[var(--e-radius)] object-cover"
                    />
                    <EButton
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1 h-7 w-7 bg-[hsl(var(--e-surface)/0.9)]"
                      onClick={() => setRefImages((prev) => prev.filter((r) => r.key !== img.key))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--e-danger))]" />
                    </EButton>
                  </div>
                  <EInput
                    value={img.label ?? ""}
                    placeholder="Label (optional)"
                    className="h-8 text-[0.75rem]"
                    onChange={(e) =>
                      setRefImages((prev) =>
                        prev.map((r) => (r.key === img.key ? { ...r, label: e.target.value } : r)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* What's included — editable per-quote checklist (this panel IS the preview) */}
      <ECard>
        <ECardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <ECardTitle className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
              What&apos;s included
              {checklistTouched ? (
                <span className="rounded-full bg-[hsl(var(--e-gold-soft))] px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">
                  Customised
                </span>
              ) : null}
            </ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              This is what the client will receive — edit it for this quote before sending.
            </p>
          </div>
          {editChecklist ? (
            <div className="flex shrink-0 items-center gap-2">
              {checklistTouched ? (
                <EButton type="button" size="sm" variant="ghost" onClick={resetChecklist}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </EButton>
              ) : null}
              <EButton
                type="button"
                size="sm"
                variant={editingChecklist ? "primary" : "outline"}
                onClick={() => setEditingChecklist((v) => !v)}
              >
                {editingChecklist ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                {editingChecklist ? "Done editing" : "Edit checklist"}
              </EButton>
            </div>
          ) : null}
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          {checklistLoading ? (
            <div className="flex items-center gap-2 py-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the {serviceLabel.toLowerCase()} checklist…
            </div>
          ) : !editChecklist ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              No checklist is configured for this service yet.
            </p>
          ) : editingChecklist ? (
            /* ─── Edit mode: section-grouped editor ─── */
            <div className="space-y-4">
              <EField label="Summary (shown at the top of the checklist)">
                <ETextarea
                  value={editChecklist.summary}
                  onChange={(e) => updateSummary(e.target.value)}
                  rows={2}
                  placeholder="One-line description of this service…"
                />
              </EField>

              {editChecklist.sections.map((section) => (
                <div
                  key={section.id}
                  className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                >
                  <EEyebrow>{section.title}</EEyebrow>
                  <div className="space-y-2">
                    {section.items.length === 0 ? (
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No items.</p>
                    ) : (
                      section.items.map((it) => (
                        <div key={it.id} className="flex items-center gap-2">
                          <button
                            type="button"
                            title={it.covered ? "Included — click to exclude" : "Excluded — click to include"}
                            onClick={() => toggleItem(section.id, it.id)}
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--e-radius)] border transition-colors ${
                              it.covered
                                ? "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success)/0.12)] text-[hsl(var(--e-success))]"
                                : "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.1)] text-[hsl(var(--e-danger))]"
                            }`}
                          >
                            {it.covered ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                          </button>
                          <EInput
                            value={it.label}
                            onChange={(e) => renameItem(section.id, it.id, e.target.value)}
                            className={it.covered ? "" : "line-through opacity-70"}
                          />
                          <EButton
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={() => removeItem(section.id, it.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--e-danger))]" />
                          </EButton>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <EInput
                      value={newItemLabels[section.id] ?? ""}
                      placeholder={`Add an item to ${section.title}…`}
                      onChange={(e) =>
                        setNewItemLabels((prev) => ({ ...prev, [section.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addItem(section.id);
                        }
                      }}
                    />
                    <EButton type="button" variant="outline" onClick={() => addItem(section.id)}>
                      <Plus className="h-4 w-4" /> Add item
                    </EButton>
                  </div>
                </div>
              ))}

              {/* Not included / exclusions editor */}
              <div className="space-y-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-3">
                <EEyebrow>Not included</EEyebrow>
                {editChecklist.notCovered.length > 0 ? (
                  <div className="space-y-2">
                    {editChecklist.notCovered.map((line, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <X className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-danger))]" />
                        <EInput value={line} onChange={(e) => updateExclusion(i, e.target.value)} />
                        <EButton
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => removeExclusion(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--e-danger))]" />
                        </EButton>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <EInput
                    value={newExclusion}
                    placeholder="Add an exclusion the client should know about…"
                    onChange={(e) => setNewExclusion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addExclusion();
                      }
                    }}
                  />
                  <EButton type="button" variant="outline" onClick={addExclusion}>
                    <Plus className="h-4 w-4" /> Add exclusion
                  </EButton>
                </div>
              </div>
            </div>
          ) : (
            /* ─── Preview mode: what the client sees ─── */
            <>
              {editChecklist.summary ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{editChecklist.summary}</p>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                  <EEyebrow>Included</EEyebrow>
                  {includedItems.length === 0 ? (
                    <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No items listed.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {includedItems.map((label, i) => (
                        <li key={i} className="flex items-start gap-2 text-[0.8125rem]">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-success))]" />
                          <span>{label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                  <EEyebrow>Not included</EEyebrow>
                  {notIncludedItems.length === 0 ? (
                    <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      Nothing specifically excluded.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {notIncludedItems.map((label, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]"
                        >
                          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-danger))]" />
                          <span>{label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}

          {selectedExtraDetails.length > 0 ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
              <EEyebrow>Added on this quote</EEyebrow>
              <ul className="mt-2 space-y-1.5">
                {selectedExtraDetails.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                    <span className="flex items-start gap-2">
                      <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-gold-ink))]" />
                      <span>{e.label}</span>
                    </span>
                    <span className="e-tnum shrink-0 text-[hsl(var(--e-muted-foreground))]">{money(e.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {/* Line items */}
      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Line items</ECardTitle>
          <EButton
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLineItems((p) => [...p, { label: "", unitPrice: 0, qty: 1, total: 0 }])}
          >
            <Plus className="h-4 w-4" /> Add line
          </EButton>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          {lineItems.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No line items yet — calculate from the rate card or add lines manually.
            </p>
          ) : (
            lineItems.map((li, idx) => (
              <div key={idx} className="grid grid-cols-12 items-center gap-2">
                <EInput
                  className="col-span-6"
                  value={li.label}
                  placeholder="Description"
                  onChange={(e) => updateItem(idx, { label: e.target.value })}
                />
                <EInput
                  className="col-span-2"
                  type="number"
                  step="0.01"
                  value={li.unitPrice}
                  onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                />
                <EInput
                  className="col-span-1"
                  type="number"
                  value={li.qty}
                  onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })}
                />
                <div className="col-span-2 text-right text-[0.875rem] e-tnum">{money(li.total)}</div>
                <EButton
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="col-span-1 h-8 w-8"
                  onClick={() => setLineItems((p) => p.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                </EButton>
              </div>
            ))
          )}

          {variableLineItems.length > 0 ? (
            <div className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <EEyebrow>Pricing adjustments</EEyebrow>
              {variableLineItems.map((li, i) => (
                <div key={i} className="flex items-center justify-between text-[0.8125rem]">
                  <span className="text-[hsl(var(--e-text-secondary))]">{li.label}</span>
                  <span className="e-tnum">{money(li.total)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {extraLines.length > 0 ? (
            <div className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <EEyebrow>Extras included</EEyebrow>
              {extraLines.map((li, i) => (
                <div key={i} className="flex items-center justify-between text-[0.8125rem]">
                  <span className="text-[hsl(var(--e-text-secondary))]">{li.label}</span>
                  <span className="e-tnum">{money(li.total)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 pt-2 md:grid-cols-3">
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>Subtotal</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{money(subtotal)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>{gstLabel}</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{money(gstAmount)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
              <EEyebrow>Total</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none text-[hsl(var(--e-gold-ink))]">
                {money(totalAmount)}
              </p>
            </div>
          </div>
        </ECardBody>
      </ECard>

      {/* Notes + validity + actions */}
      <ECard>
        <ECardBody className="space-y-4 pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <EField label="Valid until (optional)">
              <EInput type="date" value={validUntilDate} onChange={(e) => setValidUntilDate(e.target.value)} />
            </EField>
          </div>
          <EField
            label={
              <span className="flex items-center justify-between gap-2">
                <span>Notes (auto-drafted — editable)</span>
                <button
                  type="button"
                  onClick={() => {
                    setNotesTouched(false);
                    setNotes(buildAutoNotes());
                  }}
                  className="inline-flex items-center gap-1 text-[0.6875rem] font-medium normal-case tracking-normal text-[hsl(var(--e-gold-ink))] hover:underline"
                >
                  <RotateCcw className="h-3 w-3" /> Regenerate
                </button>
              </span>
            }
          >
            <ETextarea
              value={notes}
              onChange={(e) => {
                setNotesTouched(true);
                setNotes(e.target.value);
              }}
              placeholder="Scope, inclusions, exclusions…"
            />
          </EField>
          <div className="flex flex-wrap justify-end gap-2">
            <EButton variant="ghost" onClick={openPreview} disabled={saving || previewing}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              {previewing ? "Rendering…" : "Preview"}
            </EButton>
            {isEdit ? (
              <>
                <EButton variant="outline" onClick={() => router.push(`/v2/admin/quotes/${editQuote!.id}`)} disabled={saving}>
                  Cancel
                </EButton>
                <EButton variant="gold" onClick={saveEdit} disabled={saving}>
                  <Check className="h-4 w-4" />
                  {saving ? "Saving…" : "Save changes"}
                </EButton>
              </>
            ) : (
              <>
                <EButton variant="outline" onClick={() => submit(false)} disabled={saving}>
                  {saving ? "Saving…" : "Create draft"}
                </EButton>
                <EButton variant="gold" onClick={() => submit(true)} disabled={saving}>
                  <Send className="h-4 w-4" />
                  {saving ? "Working…" : "Create & send"}
                </EButton>
              </>
            )}
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
