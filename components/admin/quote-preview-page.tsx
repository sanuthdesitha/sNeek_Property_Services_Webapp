"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";

const DRAFT_KEY = "sneek.quoteDraft.v1";

type QuoteDraft = {
  leadId?: string;
  clientId?: string;
  serviceType: string;
  lineItems: Array<{
    label: string;
    unitPrice: number;
    qty: number;
    total: number;
  }>;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  notes?: string;
  validUntil?: string;
};

type QuoteMeta = {
  bedrooms?: number;
  bathrooms?: number;
  floors?: number;
  sqm?: number;
  conditionScore?: number;
  steamCarpetRooms?: number;
  windowAreaSqm?: number;
  pressureWashSqm?: number;
};

function parseNotes(notes?: string): { cleanNotes: string; meta: QuoteMeta | null } {
  if (!notes) return { cleanNotes: "", meta: null };
  const markerRegex = /\[\[META:([\s\S]+?)\]\]/;
  const match = notes.match(markerRegex);
  if (!match) {
    return { cleanNotes: notes, meta: null };
  }

  let meta: QuoteMeta | null = null;
  try {
    meta = JSON.parse(match[1]);
  } catch {
    meta = null;
  }

  return { cleanNotes: notes.replace(markerRegex, "").trim(), meta };
}

export function QuotePreviewPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) {
      setDraft(null);
      setLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.lineItems) || typeof parsed.serviceType !== "string") {
        setDraft(null);
      } else {
        setDraft(parsed as QuoteDraft);
      }
    } catch {
      setDraft(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const { cleanNotes, meta } = useMemo(() => parseNotes(draft?.notes), [draft?.notes]);

  async function downloadPreviewPdf() {
    if (!draft) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/admin/quotes/preview-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not generate preview file.");
      }

      const blob = await res.blob();
      const contentType = res.headers.get("content-type") ?? "";
      const extension = contentType.includes("application/pdf") ? "pdf" : "html";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quote-preview.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "Preview downloaded" });
    } catch (err: any) {
      toast({
        title: "Download failed",
        description: err.message ?? "Could not download preview.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  async function saveQuote() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not save quote.");
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(DRAFT_KEY);
      }
      toast({ title: "Quote created" });
      router.push("/admin/quotes");
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message ?? "Could not save quote.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading quote preview...</p>;
  }

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No quote draft found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Open the new quote form, set details, and click Preview quote.</p>
          <Button asChild>
            <Link href="/admin/quotes/new">Go to new quote</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">Quote Preview</h2>
          <p className="text-sm text-muted-foreground">Review before saving or sending.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/quotes/new">Back to edit</Link>
          </Button>
          <Button variant="outline" onClick={downloadPreviewPdf} disabled={downloading || saving}>
            {downloading ? "Preparing..." : "Download preview"}
          </Button>
          <Button onClick={saveQuote} disabled={saving || downloading}>
            {saving ? "Saving..." : "Save quote"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Summary</CardTitle>
          <Badge variant="secondary">{draft.serviceType.replace(/_/g, " ")}</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Subtotal</p>
            <p className="text-lg font-semibold">{formatCurrency(Number(draft.subtotal || 0))}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">GST</p>
            <p className="text-lg font-semibold">{formatCurrency(Number(draft.gstAmount || 0))}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold">{formatCurrency(Number(draft.totalAmount || 0))}</p>
          </div>
          {draft.validUntil ? (
            <div className="rounded-md border p-3 md:col-span-3">
              <p className="text-xs text-muted-foreground">Valid Until</p>
              <p className="text-sm font-medium">{new Date(draft.validUntil).toLocaleDateString("en-AU")}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {meta ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service Parameters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-4">
            {meta.bedrooms ? <p>Bedrooms: {meta.bedrooms}</p> : null}
            {meta.bathrooms ? <p>Bathrooms: {meta.bathrooms}</p> : null}
            {meta.floors ? <p>Floors: {meta.floors}</p> : null}
            {meta.sqm ? <p>Area: {meta.sqm} sqm</p> : null}
            {meta.conditionScore ? <p>Condition: {meta.conditionScore}/5</p> : null}
            {meta.steamCarpetRooms ? <p>Steam carpet: {meta.steamCarpetRooms} room(s)</p> : null}
            {meta.windowAreaSqm ? <p>Window clean: {meta.windowAreaSqm} sqm</p> : null}
            {meta.pressureWashSqm ? <p>Pressure wash: {meta.pressureWashSqm} sqm</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-xs text-muted-foreground">
                <th className="p-3 text-left">Item</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Unit</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {draft.lineItems.map((item, index) => (
                <tr key={`${item.label}-${index}`}>
                  <td className="p-3">{item.label}</td>
                  <td className="p-3 text-right">{Number(item.qty).toFixed(2)}</td>
                  <td className="p-3 text-right">{formatCurrency(Number(item.unitPrice || 0))}</td>
                  <td className="p-3 text-right">{formatCurrency(Number(item.total || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {cleanNotes ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{cleanNotes}</pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
