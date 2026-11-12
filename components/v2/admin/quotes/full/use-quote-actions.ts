"use client";

/**
 * Writes on a saved quote, each through the route the old detail page used:
 *   GET    /api/admin/quotes/[id]/pdf                 preview / download
 *   PATCH  /api/admin/quotes/[id]                     status, details, public link
 *   POST   /api/admin/quotes/[id]/send?preview=1      render the email, send nothing
 *   POST   /api/admin/quotes/[id]/send                send (recipient optional)
 *   POST   /api/admin/quotes/[id]/requested-addons    accept / dismiss
 *   DELETE /api/admin/quotes/[id]
 * Nothing reports success before the route answers OK.
 */
import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { QuoteRequestedAddOn } from "@/lib/quotes/quote-record";

export type EmailPreview = {
  quoteId: string;
  to: string | null;
  subject: string;
  html: string;
  attachments: Array<{ filename: string; size?: number }>;
  publicUrl?: string;
  recipients: string[];
  /** Opened right after "Create and send": cancelling keeps the new draft. */
  afterCreate: boolean;
};

type Json = Record<string, unknown>;

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Json }> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Json;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "The request did not reach the server." } };
  }
}

function errorOf(data: Json, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

export function useQuoteActions(onChanged: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);

  useEffect(() => () => {
    if (pdfUrl) window.URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  async function run<T>(key: string, work: () => Promise<T>): Promise<T> {
    setBusy(key);
    try {
      return await work();
    } finally {
      setBusy(null);
    }
  }

  async function fetchPdf(quoteId: string): Promise<Blob | null> {
    const res = await fetch(`/api/admin/quotes/${quoteId}/pdf`).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as Json) : {};
      toast({ title: "Could not render the quote", description: errorOf(body, "The PDF could not be rendered."), variant: "destructive" });
      return null;
    }
    return res.blob();
  }

  const previewPdf = (quoteId: string) =>
    run("pdf", async () => {
      const blob = await fetchPdf(quoteId);
      if (blob) setPdfUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return window.URL.createObjectURL(blob);
      });
    });

  /** Unsaved or new quote: the same render from the builder's current body (`POST /api/admin/quotes/preview-pdf`). */
  const previewDraftPdf = (body: Json) =>
    run("pdf", async () => {
      const res = await fetch("/api/admin/quotes/preview-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      if (!res || !res.ok) {
        const data = res ? ((await res.json().catch(() => ({}))) as Json) : {};
        return toast({ title: "Preview failed", description: errorOf(data, "Could not render the quote preview."), variant: "destructive" });
      }
      const blob = await res.blob();
      setPdfUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return window.URL.createObjectURL(blob);
      });
    });

  const downloadPdf = (quoteId: string) =>
    run("download", async () => {
      const blob = await fetchPdf(quoteId);
      if (!blob) return;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quote-${quoteId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    });

  const closePdf = () => setPdfUrl((prev) => {
    if (prev) window.URL.revokeObjectURL(prev);
    return null;
  });

  /** Mints the token on first copy; the route promotes a draft to Sent (sharing is sending). */
  const copyPublicLink = (quoteId: string, token: string | null) =>
    run("link", async () => {
      let current = token;
      if (!current) {
        const result = await call(`/api/admin/quotes/${quoteId}`, "PATCH", { generatePublicToken: true });
        if (!result.ok) return toast({ title: "Could not create the public link", description: errorOf(result.data, "Please try again."), variant: "destructive" });
        current = typeof result.data.publicToken === "string" ? result.data.publicToken : null;
        await onChanged();
      }
      if (!current) return toast({ title: "Could not create the public link.", variant: "destructive" });
      const url = `${window.location.origin}/q/${current}`;
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "Public link copied", description: url });
      } catch {
        toast({ title: "Could not copy the link", description: url, variant: "destructive" });
      }
    });

  const openEmailPreview = (quoteId: string, to: string | null, afterCreate = false) =>
    run("preview", async () => {
      const result = await call(`/api/admin/quotes/${quoteId}/send?preview=1`, "POST", { ...(to ? { to } : {}), preview: true });
      if (!result.ok) {
        toast({ title: "Email preview failed", description: errorOf(result.data, "Could not render the email."), variant: "destructive" });
        return false;
      }
      const d = result.data;
      setEmailPreview({
        quoteId,
        to,
        subject: String(d.subject ?? ""),
        html: String(d.html ?? ""),
        attachments: Array.isArray(d.attachments) ? (d.attachments as EmailPreview["attachments"]) : [],
        publicUrl: typeof d.publicUrl === "string" ? d.publicUrl : undefined,
        recipients: Array.isArray(d.recipients) ? (d.recipients as string[]) : to ? [to] : [],
        afterCreate,
      });
      return true;
    });

  const confirmSend = () =>
    run("send", async () => {
      if (!emailPreview) return false;
      const result = await call(`/api/admin/quotes/${emailPreview.quoteId}/send`, "POST", emailPreview.to ? { to: emailPreview.to } : {});
      if (!result.ok) {
        toast({ title: "Send failed", description: errorOf(result.data, "Could not send the quote."), variant: "destructive" });
        return false;
      }
      const count = Array.isArray(result.data.attachments) ? result.data.attachments.length : 0;
      toast({ title: "Quote sent", description: `Handed to the email provider with ${count} attachment(s). Delivery is not confirmed here.` });
      setEmailPreview(null);
      await onChanged();
      return true;
    });

  const patch = (quoteId: string, body: Json, success: string) =>
    run("patch", async () => {
      const result = await call(`/api/admin/quotes/${quoteId}`, "PATCH", body);
      if (!result.ok) {
        toast({ title: "Update failed", description: errorOf(result.data, "Could not update the quote."), variant: "destructive" });
        return false;
      }
      toast({ title: success });
      await onChanged();
      return true;
    });

  const requestedAddOns = (quoteId: string, action: "accept" | "dismiss", items: Array<QuoteRequestedAddOn & { price: number }>) =>
    run("addons", async () => {
      const payload = items.map((a) => ({ ...(a.id ? { id: a.id } : {}), label: a.label, ...(action === "accept" ? { price: Math.max(0, a.price) } : {}) }));
      const result = await call(`/api/admin/quotes/${quoteId}/requested-addons`, "POST", { action, items: payload });
      if (!result.ok) {
        toast({ title: action === "accept" ? "Could not add add-ons" : "Could not dismiss", description: errorOf(result.data, "Please try again."), variant: "destructive" });
        return false;
      }
      if (action === "accept") {
        const total = typeof result.data.totalAmount === "number" ? result.data.totalAmount : null;
        toast({ title: "Added to the quote", description: `${items.length} add-on${items.length > 1 ? "s" : ""} added${total != null ? `. New total $${total.toFixed(2)}` : ""}. Resend so the client sees it.` });
      } else {
        toast({ title: "Request dismissed" });
      }
      await onChanged();
      return true;
    });

  const deleteQuote = (quoteId: string) =>
    run("delete", async () => {
      const result = await call(`/api/admin/quotes/${quoteId}`, "DELETE");
      if (!result.ok) return { ok: false as const, error: errorOf(result.data, "The quote could not be deleted.") };
      return { ok: true as const };
    });

  return { busy, pdfUrl, closePdf, previewPdf, previewDraftPdf, downloadPdf, copyPublicLink, emailPreview, setEmailPreview, openEmailPreview, confirmSend, patch, requestedAddOns, deleteQuote };
}

export type QuoteActions = ReturnType<typeof useQuoteActions>;
