"use client";

/**
 * ESTATE quote detail — v2-native view/manage screen for a single quote.
 * Same endpoints as the pipeline:
 *   PATCH  /api/admin/quotes/[id]          { status | notes | validUntil | clientId }
 *   POST   /api/admin/quotes/[id]/send     { to? }
 *   GET    /api/admin/quotes/[id]/pdf      (download)
 *   POST   /api/admin/quotes/[id]/convert-to-job
 *            { propertyId? | newProperty?{address,suburb,name?}, createJob, scheduledDate? }
 * Built on v2 primitives + estate-kit only.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarPlus, Copy, Download, Eye, Loader2, Mail, PackagePlus, Paperclip, Pencil, Send, Tag, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";
import { EField, EInput, ETextarea, ESelect, EModal, ESwitch } from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import QuoteTimeline from "@/components/v2/admin/quotes/quote-timeline";
import { formatCurrency } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "danger" | "gold";
const QUOTE_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "success",
  DECLINED: "danger",
  CONVERTED: "gold",
};
const STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED"];

type Party = { id: string; name: string; email: string; address?: string | null; suburb?: string | null };
type ReferenceImage = { key: string; url: string; label?: string };
type Frequency = "one_off" | "weekly" | "fortnightly" | "monthly";
type QuoteInitial = {
  id: string;
  status: string;
  serviceType: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  notes: string;
  validUntil: string | null;
  createdAt: string;
  clientId: string | null;
  client: Party | null;
  lead: Party | null;
  publicToken?: string | null;
  showAddOnPrices?: boolean;
  referenceImages?: ReferenceImage[];
  serviceContext?: Record<string, string | number | boolean> | null;
  frequency?: string | null;
  serviceAddress?: string | null;
  serviceSuburb?: string | null;
  requestedAddOns?: RequestedAddOn[];
  discountCode?: string | null;
  discountAmount?: number;
  discountLabel?: string | null;
};

type RequestedAddOn = { id?: string; label: string; price: number; note?: string; requestedAt?: string };

const prettify = (v?: string | null) => String(v ?? "").replace(/_/g, " ").trim();
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

const RECURRING: Record<string, { label: string; blurb: string }> = {
  weekly: { label: "Weekly", blurb: "We'll create the first visit and save a weekly recurring schedule on the property." },
  fortnightly: {
    label: "Fortnightly",
    blurb: "We'll create the first visit and save a fortnightly recurring schedule on the property.",
  },
  monthly: { label: "Monthly", blurb: "We'll create the first visit and save a monthly recurring schedule on the property." },
};

export function QuoteDetail({ initial, clients }: { initial: QuoteInitial; clients: Party[] }) {
  const router = useRouter();
  const [quote, setQuote] = useState<QuoteInitial>(initial);
  const [status, setStatus] = useState(initial.status);
  const [notes, setNotes] = useState(initial.notes);
  const [validUntil, setValidUntil] = useState(dateInput(initial.validUntil));
  const [clientId, setClientId] = useState(initial.clientId ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [sending, setSending] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [propertiesLoaded, setPropertiesLoaded] = useState(false);
  const [properties, setProperties] = useState<Array<{ id: string; name: string; suburb?: string | null }>>([]);
  const [convertPropertyId, setConvertPropertyId] = useState("");
  const [convertDate, setConvertDate] = useState("");
  // Link an existing property, or create one from the service address.
  const [propertyMode, setPropertyMode] = useState<"existing" | "new">("existing");
  const [newAddress, setNewAddress] = useState("");
  const [newSuburb, setNewSuburb] = useState("");
  const [newName, setNewName] = useState("");
  // Geo captured from the address autocomplete (optional — persisted on the new property).
  const [newLat, setNewLat] = useState<number | null>(null);
  const [newLng, setNewLng] = useState<number | null>(null);
  // Create the job now, or just link/create the property + mark the quote won.
  const [createJobNow, setCreateJobNow] = useState(true);

  const freq = (initial.frequency ?? "one_off") as Frequency;
  const recurringInfo = RECURRING[freq];

  // Best-known service address for prefill: explicit quote address, else the
  // client's, else the lead's. Drives the "ask the address first" gate below.
  const prefillAddress = (initial.serviceAddress ?? initial.client?.address ?? initial.lead?.address ?? "").trim();
  const prefillSuburb = (initial.serviceSuburb ?? initial.client?.suburb ?? initial.lead?.suburb ?? "").trim();

  useEffect(() => {
    if (!convertOpen || propertiesLoaded) return;
    // Scope to the quote's client when it has one, so the dropdown only lists
    // that client's properties (the ones a job may legally attach to).
    const url = initial.clientId
      ? `/api/admin/properties?clientId=${encodeURIComponent(initial.clientId)}`
      : "/api/admin/properties";
    fetch(url, { cache: "no-store" })
      .then((res) => res.json().catch(() => []))
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : Array.isArray(rows?.properties) ? rows.properties : [];
        setProperties(list);
        setPropertiesLoaded(true);
        // No properties to link → force "create new" so the admin supplies an address.
        if (list.length === 0) setPropertyMode("new");
      })
      .catch(() => {
        setProperties([]);
        setPropertiesLoaded(true);
        setPropertyMode("new");
      });
  }, [convertOpen, propertiesLoaded, initial.clientId]);

  // When the modal opens, seed the new-property fields from the best-known address.
  useEffect(() => {
    if (!convertOpen) return;
    setNewAddress((v) => v || prefillAddress);
    setNewSuburb((v) => v || prefillSuburb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertOpen]);

  // Convert is blocked until we have a resolvable property AND (if creating a
  // job) a date. Creating a new property also needs a client on the quote.
  const propertyReady =
    propertyMode === "existing"
      ? Boolean(convertPropertyId)
      : Boolean(newAddress.trim() && newSuburb.trim() && initial.clientId);
  const convertBlocked = converting || !propertyReady || (createJobNow && !convertDate);

  async function convertToJob() {
    if (!propertyReady) {
      toast({
        title:
          propertyMode === "new" && !initial.clientId
            ? "Assign this quote to a client before creating a property."
            : "A service address is required.",
        variant: "destructive",
      });
      return;
    }
    if (createJobNow && !convertDate) {
      toast({ title: "A scheduled date is required to create the job now.", variant: "destructive" });
      return;
    }
    setConverting(true);
    try {
      const payload: Record<string, unknown> = { createJob: createJobNow };
      if (propertyMode === "existing") {
        payload.propertyId = convertPropertyId;
      } else {
        payload.newProperty = {
          address: newAddress.trim(),
          suburb: newSuburb.trim(),
          ...(newName.trim() ? { name: newName.trim() } : {}),
          ...(newLat != null && newLng != null ? { latitude: newLat, longitude: newLng } : {}),
        };
      }
      if (createJobNow) payload.scheduledDate = `${convertDate}T00:00:00.000Z`;

      const res = await fetch(`/api/admin/quotes/${quote.id}/convert-to-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to convert quote.");
      toast({ title: createJobNow ? "Quote converted to job" : "Quote marked won — schedule the visit when ready" });
      setConvertOpen(false);
      if (createJobNow && body.job?.id) {
        router.push(`/v2/admin/jobs/${body.job.id}`);
      }
      router.refresh();
    } catch (err: any) {
      toast({ title: "Convert failed", description: err?.message ?? "Failed to convert quote.", variant: "destructive" });
    } finally {
      setConverting(false);
    }
  }

  async function patch(body: Record<string, unknown>): Promise<QuoteInitial | null> {
    const res = await fetch(`/api/admin/quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Update failed", description: data.error ?? "Could not update quote.", variant: "destructive" });
      return null;
    }
    return data as QuoteInitial;
  }

  async function saveDetails() {
    setSavingDetails(true);
    try {
      const updated = await patch({
        status,
        notes: notes.trim() ? notes.trim() : null,
        validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
      });
      if (updated) {
        setQuote((q) => ({ ...q, ...updated }));
        toast({ title: "Quote updated" });
        router.refresh();
      }
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveClient() {
    setSavingClient(true);
    try {
      const updated = await patch({ clientId: clientId || null });
      if (updated) {
        setQuote((q) => ({ ...q, ...updated }));
        toast({ title: clientId ? "Quote assigned to client" : "Quote unassigned" });
        router.refresh();
      }
    } finally {
      setSavingClient(false);
    }
  }

  // ── Send with an email preview step (render first, confirm, then send) ────
  type EmailPreview = {
    to: string;
    subject: string;
    html: string;
    attachments: Array<{ filename: string; size?: number }>;
    publicUrl?: string;
  };
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [sendingNow, setSendingNow] = useState(false);

  async function sendQuote() {
    const recipient = window.prompt("Send quote to email:", quote.client?.email ?? quote.lead?.email ?? "");
    if (!recipient) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/send?preview=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipient, preview: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Preview failed", description: body.error ?? "Could not render the email.", variant: "destructive" });
        return;
      }
      setEmailPreview({
        to: recipient,
        subject: String(body.subject ?? ""),
        html: String(body.html ?? ""),
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        publicUrl: typeof body.publicUrl === "string" ? body.publicUrl : undefined,
      });
    } finally {
      setSending(false);
    }
  }

  async function confirmSend() {
    if (!emailPreview) return;
    setSendingNow(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailPreview.to }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Send failed", description: body.error ?? "Could not send quote.", variant: "destructive" });
        return;
      }
      toast({
        title: "Quote sent",
        description: `Sent to ${emailPreview.to} with ${
          Array.isArray(body.attachments) ? body.attachments.length : 0
        } attachment(s).`,
      });
      setEmailPreview(null);
      router.refresh();
    } finally {
      setSendingNow(false);
    }
  }

  // ── Client-requested add-ons (price them in, then re-send) ────────────────
  const [requested, setRequested] = useState<RequestedAddOn[]>(initial.requestedAddOns ?? []);
  // Editable price per pending request, keyed by id-or-label.
  const addOnKey = (a: { id?: string; label: string }) => (a.id ? `id:${a.id}` : `label:${a.label.toLowerCase()}`);
  const [addOnPrices, setAddOnPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial.requestedAddOns ?? []).map((a) => [addOnKey(a), String(a.price || 0)]))
  );
  const [addOnBusy, setAddOnBusy] = useState(false);

  function setAddOnPrice(a: RequestedAddOn, value: string) {
    setAddOnPrices((prev) => ({ ...prev, [addOnKey(a)]: value }));
  }

  async function postRequestedAddOns(action: "accept" | "dismiss", items: RequestedAddOn[]) {
    const payload = items.map((a) => ({
      ...(a.id ? { id: a.id } : {}),
      label: a.label,
      ...(action === "accept" ? { price: Math.max(0, Number(addOnPrices[addOnKey(a)] ?? a.price) || 0) } : {}),
    }));
    const res = await fetch(`/api/admin/quotes/${quote.id}/requested-addons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, items: payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: action === "accept" ? "Could not add add-ons" : "Could not dismiss", description: body.error ?? "Please try again.", variant: "destructive" });
      return null;
    }
    setRequested(Array.isArray(body.requestedAddOns) ? body.requestedAddOns : []);
    if (action === "accept") {
      // Reflect the new pricing + notes immediately so the preview is up to date.
      setQuote((q) => ({
        ...q,
        subtotal: typeof body.subtotal === "number" ? body.subtotal : q.subtotal,
        gstAmount: typeof body.gstAmount === "number" ? body.gstAmount : q.gstAmount,
        totalAmount: typeof body.totalAmount === "number" ? body.totalAmount : q.totalAmount,
        notes: typeof body.notes === "string" ? body.notes : q.notes,
      }));
      if (typeof body.notes === "string") setNotes(body.notes);
    }
    return body;
  }

  async function acceptAddOns(items: RequestedAddOn[], thenReview: boolean) {
    if (items.length === 0) return;
    setAddOnBusy(true);
    try {
      const body = await postRequestedAddOns("accept", items);
      if (!body) return;
      const added = items.reduce((sum, a) => sum + (Number(addOnPrices[addOnKey(a)] ?? a.price) || 0), 0);
      toast({
        title: "Added to the quote",
        description: `${items.length} add-on${items.length > 1 ? "s" : ""} (+${formatCurrency(added)} ex GST). New total ${formatCurrency(
          typeof body.totalAmount === "number" ? body.totalAmount : quote.totalAmount
        )}.`,
      });
      router.refresh();
      if (thenReview) await sendQuote();
    } finally {
      setAddOnBusy(false);
    }
  }

  async function dismissAddOn(item: RequestedAddOn) {
    setAddOnBusy(true);
    try {
      await postRequestedAddOns("dismiss", [item]);
    } finally {
      setAddOnBusy(false);
    }
  }

  // ── Discount & coupon code ────────────────────────────────────────────────
  const [discountCode, setDiscountCode] = useState<string | null>(initial.discountCode ?? null);
  const [discountAmount, setDiscountAmount] = useState<number>(initial.discountAmount ?? 0);
  const [discountLabel, setDiscountLabel] = useState<string | null>(initial.discountLabel ?? null);
  const [couponInput, setCouponInput] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [discountBusy, setDiscountBusy] = useState(false);

  async function postDiscount(payload: { code?: string; amount?: number; label?: string; clear?: boolean }) {
    setDiscountBusy(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/discount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Discount not applied", description: body.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      setDiscountCode(body.discountCode ?? null);
      setDiscountAmount(Number(body.discountAmount) || 0);
      setDiscountLabel(body.discountLabel ?? null);
      setCouponInput("");
      setManualInput("");
      setQuote((q) => ({
        ...q,
        subtotal: typeof body.subtotal === "number" ? body.subtotal : q.subtotal,
        gstAmount: typeof body.gstAmount === "number" ? body.gstAmount : q.gstAmount,
        totalAmount: typeof body.totalAmount === "number" ? body.totalAmount : q.totalAmount,
      }));
      toast({
        title: payload.clear ? "Discount removed" : "Discount applied",
        description: payload.clear
          ? "The quote is back to full price."
          : `−${formatCurrency(Number(body.discountAmount) || 0)} · new total ${formatCurrency(
              typeof body.totalAmount === "number" ? body.totalAmount : quote.totalAmount
            )}.`,
      });
      router.refresh();
    } finally {
      setDiscountBusy(false);
    }
  }

  // ── Shareable public link (mint the token on first copy) ──────────────────
  const [copyingLink, setCopyingLink] = useState(false);

  async function copyPublicLink() {
    setCopyingLink(true);
    try {
      let token = quote.publicToken ?? null;
      if (!token) {
        const updated = await patch({ generatePublicToken: true });
        if (!updated) return;
        token = (updated as QuoteInitial).publicToken ?? null;
        setQuote((q) => ({ ...q, ...updated }));
      }
      if (!token) {
        toast({ title: "Could not create the public link.", variant: "destructive" });
        return;
      }
      const url = `${window.location.origin}/q/${token}`;
      await navigator.clipboard.writeText(url);
      toast({ title: "Public link copied", description: url });
    } catch {
      toast({ title: "Could not copy the link.", variant: "destructive" });
    } finally {
      setCopyingLink(false);
    }
  }

  // ── Add-on price visibility (persists immediately) ────────────────────────
  const [addOnPricesVisible, setAddOnPricesVisible] = useState(Boolean(initial.showAddOnPrices));

  async function toggleAddOnPrices(value: boolean) {
    setAddOnPricesVisible(value);
    const updated = await patch({ showAddOnPrices: value });
    if (!updated) {
      setAddOnPricesVisible(!value); // revert on failure
    } else {
      setQuote((q) => ({ ...q, ...updated }));
      toast({
        title: value ? "Add-on prices shown to client" : "Add-on prices hidden",
        description: "Applies to the attached add-on list and the online quote.",
      });
    }
  }

  // Inline preview — same render endpoint as the PDF download; the blob is
  // shown in an iframe (works for both application/pdf and the HTML fallback).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openPreview() {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/admin/quotes/${quote.id}/pdf`);
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
      toast({ title: "Preview failed", description: err?.message ?? "Could not render preview.", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewUrl((prev) => {
      if (prev) window.URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function downloadPdf() {
    const res = await fetch(`/api/admin/quotes/${quote.id}/pdf`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Download failed", description: body.error ?? "Could not export PDF.", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quote-${quote.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  const recipientName = quote.client?.name ?? quote.lead?.name ?? "Direct quote";
  const recipientEmail = quote.client?.email ?? quote.lead?.email ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EButton asChild variant="outline" size="sm">
          <Link href="/v2/admin/quotes">Back to pipeline</Link>
        </EButton>
        <div className="flex flex-wrap items-center gap-2">
          <EButton variant="ghost" size="sm" onClick={openPreview} disabled={previewLoading}>
            {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview
          </EButton>
          <EButton variant="ghost" size="sm" onClick={downloadPdf}>
            <Download className="h-3.5 w-3.5" /> PDF
          </EButton>
          <EButton variant="ghost" size="sm" onClick={copyPublicLink} disabled={copyingLink}>
            {copyingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            Copy public link
          </EButton>
          {quote.status !== "CONVERTED" ? (
            <EButton asChild variant="outline" size="sm">
              <Link href={`/v2/admin/quotes/${quote.id}/edit`}>
                <Pencil className="h-3.5 w-3.5" /> Edit quote
              </Link>
            </EButton>
          ) : null}
          <EButton variant="outline-gold" size="sm" onClick={sendQuote} disabled={sending}>
            <Send className="h-3.5 w-3.5" /> {sending ? "Preparing…" : "Send"}
          </EButton>
          {quote.status !== "CONVERTED" ? (
            <EButton variant="primary" size="sm" onClick={() => setConvertOpen(true)}>
              <CalendarPlus className="h-3.5 w-3.5" /> Convert to job
            </EButton>
          ) : null}
        </div>
      </div>

      {/* Inline document preview — same render as the emailed / downloaded quote */}
      <EModal open={Boolean(previewUrl)} onClose={closePreview} eyebrow="Quotes" title="Quote preview" size="full">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="Quote preview"
            className="h-[70vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white"
          />
        ) : null}
      </EModal>

      {/* Email preview — the exact email + attachments, confirmed before sending */}
      <EModal
        open={Boolean(emailPreview)}
        onClose={() => setEmailPreview(null)}
        eyebrow="Quotes"
        title="Review before sending"
        size="full"
      >
        {emailPreview ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <EEyebrow>To</EEyebrow>
                <p className="mt-1 text-[0.8125rem]">{emailPreview.to}</p>
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
                  <p className="mt-3 min-w-0 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Online: {emailPreview.publicUrl}
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
              <EButton variant="outline" onClick={() => setEmailPreview(null)} disabled={sendingNow}>
                Cancel
              </EButton>
              <EButton variant="gold" onClick={confirmSend} disabled={sendingNow}>
                {sendingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {sendingNow ? "Sending…" : "Send now"}
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>

      {/* Convert to job — pick/create the property, choose whether to schedule now */}
      <EModal open={convertOpen} onClose={() => setConvertOpen(false)} eyebrow="Quotes" title="Convert to job">
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {createJobNow
              ? `Creates a ${prettify(quote.serviceType).toLowerCase() || "service"} job from this quote and marks the quote as converted.`
              : "Links (or creates) the property and marks this quote as won — no job yet, so you can schedule the first visit later."}
          </p>

          {/* Frequency banner: one-off vs recurring cadence */}
          {recurringInfo ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
              <EEyebrow>{recurringInfo.label} service</EEyebrow>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{recurringInfo.blurb}</p>
            </div>
          ) : (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              One-off service — a single job will be created.
            </p>
          )}

          {/* Property: link an existing one, or create from the service address */}
          <div>
            <EEyebrow>Property</EEyebrow>
            <div className="mt-2 flex gap-2">
              <EButton
                type="button"
                size="sm"
                variant={propertyMode === "existing" ? "gold" : "outline"}
                onClick={() => setPropertyMode("existing")}
                disabled={properties.length === 0}
              >
                Link existing
              </EButton>
              <EButton
                type="button"
                size="sm"
                variant={propertyMode === "new" ? "gold" : "outline"}
                onClick={() => setPropertyMode("new")}
              >
                Create from address
              </EButton>
            </div>
          </div>

          {propertyMode === "existing" ? (
            <EField label="Existing property">
              <ESelect value={convertPropertyId} onChange={(e) => setConvertPropertyId(e.target.value)}>
                <option value="">
                  {properties.length === 0 ? "No properties for this client" : "Select property…"}
                </option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.suburb ? ` — ${p.suburb}` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : (
            <div className="space-y-3">
              {!prefillAddress ? (
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  No address is on file for this quote — enter the service address to continue.
                </p>
              ) : null}
              <EField label="Service address">
                <EAddressInput
                  value={newAddress}
                  placeholder="Start typing an address…"
                  onChange={(text) => setNewAddress(text)}
                  onSelect={(r) => {
                    setNewAddress(r.formattedAddress);
                    // Auto-fill the suburb from the selection — the admin no longer types it.
                    if (r.suburb) setNewSuburb(r.suburb);
                    setNewLat(Number.isFinite(r.lat) ? r.lat : null);
                    setNewLng(Number.isFinite(r.lng) ? r.lng : null);
                  }}
                />
              </EField>
              <EField label="Suburb">
                <EInput value={newSuburb} onChange={(e) => setNewSuburb(e.target.value)} placeholder="Bondi" />
              </EField>
              <EField label="Property name (optional)">
                <EInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Defaults to the address" />
              </EField>
              {!initial.clientId ? (
                <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">
                  Assign this quote to a client before creating a property from its address.
                </p>
              ) : null}
            </div>
          )}

          {/* Schedule now? */}
          <ESwitch
            checked={createJobNow}
            onCheckedChange={setCreateJobNow}
            label="Create a job now"
          />

          {createJobNow ? (
            <EField label="Scheduled date">
              <EInput type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} />
            </EField>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setConvertOpen(false)} disabled={converting}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={convertToJob} disabled={convertBlocked}>
              {converting ? "Converting…" : createJobNow ? "Create job" : "Mark won"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Summary */}
      <ECard>
        <ECardHeader className="flex-row items-start justify-between">
          <div className="min-w-0">
            <ECardTitle className="e-serif truncate">{recipientName}</ECardTitle>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {prettify(quote.serviceType)}
              {recipientEmail ? ` · ${recipientEmail}` : ""}
              {" · "}
              {format(new Date(quote.createdAt), "dd MMM yyyy")}
              {!quote.clientId && quote.lead?.name ? " · lead" : ""}
            </p>
          </div>
          <EBadge tone={QUOTE_TONES[quote.status] ?? "neutral"} soft>
            {prettify(quote.status)}
          </EBadge>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>Subtotal</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{formatCurrency(quote.subtotal)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <EEyebrow>GST</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none">{formatCurrency(quote.gstAmount)}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-3">
              <EEyebrow>Total</EEyebrow>
              <p className="e-numeral mt-1 text-[1.25rem] leading-none text-[hsl(var(--e-gold-ink))]">
                {formatCurrency(quote.totalAmount)}
              </p>
            </div>
          </div>
        </ECardBody>
      </ECard>

      {/* Reference photos + client-facing options */}
      {(quote.referenceImages?.length ?? 0) > 0 ||
      (quote.serviceContext && Object.keys(quote.serviceContext).length > 0) ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Quote context</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Reference photos and the pricing selections captured when this quote was built.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            {(quote.referenceImages?.length ?? 0) > 0 ? (
              <div>
                <EEyebrow>Client reference photos</EEyebrow>
                <MediaGallery
                  items={(quote.referenceImages ?? []).map((img, idx) => ({
                    id: img.key,
                    url: img.url,
                    label: img.label || `Reference ${idx + 1}`,
                    mediaType: (img as any).mediaType,
                  }))}
                  title="Client reference photos"
                  className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
                />
              </div>
            ) : null}
            {quote.serviceContext && Object.keys(quote.serviceContext).length > 0 ? (
              <div>
                <EEyebrow>Pricing selections</EEyebrow>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Array.from(Object.entries(quote.serviceContext)).map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-2.5 py-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]"
                    >
                      {prettify(key)}: <span className="font-[550]">{prettify(String(value))}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Manage */}
      {requested.length > 0 ? (
        <ECard className="border-[hsl(var(--e-gold)/0.5)]">
          <ECardHeader>
            <div className="flex items-center gap-2">
              <PackagePlus className="h-4 w-4 text-[hsl(var(--e-gold))]" />
              <ECardTitle>Client requested add-ons</ECardTitle>
              <EBadge tone="gold">{requested.length}</EBadge>
            </div>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              The client asked for these from their online quote. Set a price, add them to the quote, and re-send —
              you&apos;ll get a preview to confirm before it goes out.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-2 pt-0">
            {requested.map((a) => (
              <div
                key={addOnKey(a)}
                className="flex flex-wrap items-center gap-3 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-medium">{a.label}</p>
                  {a.note ? (
                    <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">“{a.note}”</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[0.8rem] text-[hsl(var(--e-muted-foreground))]">$</span>
                  <EInput
                    type="number"
                    min="0"
                    inputMode="decimal"
                    className="w-24"
                    value={addOnPrices[addOnKey(a)] ?? String(a.price)}
                    onChange={(e) => setAddOnPrice(a, e.target.value)}
                  />
                  <span className="text-[0.7rem] text-[hsl(var(--e-muted-foreground))]">ex GST</span>
                </div>
                <div className="flex items-center gap-1">
                  <EButton
                    variant="outline"
                    size="sm"
                    onClick={() => acceptAddOns([a], false)}
                    disabled={addOnBusy}
                  >
                    Add
                  </EButton>
                  <EButton
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissAddOn(a)}
                    disabled={addOnBusy}
                    aria-label={`Dismiss ${a.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </EButton>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <EButton variant="outline" size="sm" onClick={() => acceptAddOns(requested, false)} disabled={addOnBusy}>
                {addOnBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />} Add all to quote
              </EButton>
              <EButton variant="outline-gold" size="sm" onClick={() => acceptAddOns(requested, true)} disabled={addOnBusy}>
                {addOnBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Add all &amp; review email
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      <ECard>
        <ECardHeader>
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-[hsl(var(--e-gold))]" />
            <ECardTitle>Discount &amp; coupons</ECardTitle>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Apply a coupon code or a manual discount. It shows as a line on the quote and updates the total.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-4 pt-0">
          {discountAmount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-gold)/0.4)] bg-[hsl(var(--e-gold)/0.06)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[0.9rem] font-medium">{discountLabel ?? "Discount"}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  −{formatCurrency(discountAmount)}
                  {discountCode ? ` · code ${discountCode}` : " · manual"}
                </p>
              </div>
              <EButton variant="ghost" size="sm" onClick={() => postDiscount({ clear: true })} disabled={discountBusy}>
                <X className="h-3.5 w-3.5" /> Remove
              </EButton>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <EField label="Coupon code">
                <div className="flex gap-2">
                  <EInput
                    placeholder="e.g. WELCOME10"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && couponInput.trim()) postDiscount({ code: couponInput.trim() });
                    }}
                  />
                  <EButton
                    variant="outline"
                    size="sm"
                    onClick={() => postDiscount({ code: couponInput.trim() })}
                    disabled={discountBusy || !couponInput.trim()}
                  >
                    {discountBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                  </EButton>
                </div>
              </EField>
            </div>
            <div>
              <EField label="Manual discount ($)">
                <div className="flex gap-2">
                  <EInput
                    type="number"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                  />
                  <EButton
                    variant="outline"
                    size="sm"
                    onClick={() => postDiscount({ amount: Math.max(0, Number(manualInput) || 0) })}
                    disabled={discountBusy || !(Number(manualInput) > 0)}
                  >
                    {discountBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                  </EButton>
                </div>
              </EField>
            </div>
          </div>
        </ECardBody>
      </ECard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ECard>
          <ECardHeader>
            <ECardTitle>Status &amp; details</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <EField label="Status">
              <ESelect value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {prettify(s)}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Valid until">
              <EInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </EField>
            <EField label="Notes">
              <ETextarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, inclusions…" />
            </EField>
            <ESwitch
              checked={addOnPricesVisible}
              onCheckedChange={toggleAddOnPrices}
              label="Show add-on prices to client"
            />
            <EThread />
            <div className="flex justify-end">
              <EButton variant="primary" size="sm" onClick={saveDetails} disabled={savingDetails}>
                {savingDetails ? "Saving…" : "Save changes"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>

        <ECard>
          <ECardHeader>
            <ECardTitle>Addressed to</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Assign this quote to a client so they can view and accept it from their portal.
            </p>
          </ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <EField label="Client">
              <ESelect value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">
                  Unassigned{quote.lead?.name ? ` (lead: ${quote.lead.name})` : ""}
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? ` — ${c.email}` : ""}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EThread />
            <div className="flex justify-end">
              <EButton variant="outline" size="sm" onClick={saveClient} disabled={savingClient}>
                {savingClient ? "Saving…" : "Save assignment"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      </div>

      <ECard>
        <ECardHeader>
          <ECardTitle>Activity</ECardTitle>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Emails sent and the client&apos;s responses — updates automatically.
          </p>
        </ECardHeader>
        <ECardBody className="pt-0">
          <QuoteTimeline quoteId={quote.id} />
        </ECardBody>
      </ECard>
    </div>
  );
}
