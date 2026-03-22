"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { downloadFromApi } from "@/lib/client/download";
import { toast } from "@/hooks/use-toast";

const JOB_TYPES = [
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "GENERAL_CLEAN",
  "POST_CONSTRUCTION",
  "PRESSURE_WASH",
  "WINDOW_CLEAN",
  "LAWN_MOWING",
  "SPECIAL_CLEAN",
  "COMMERCIAL_RECURRING",
] as const;

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export function ClientInvoicesPage() {
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<any>({ clients: [], properties: [], rates: [], invoices: [] });
  const [clientId, setClientId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [rateForm, setRateForm] = useState({
    propertyId: "",
    jobType: "AIRBNB_TURNOVER",
    baseCharge: "",
    defaultDescription: "",
  });
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [busy, setBusy] = useState("");

  async function loadContext() {
    setLoading(true);
    const res = await fetch("/api/admin/invoices", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Invoices failed", description: body.error ?? "Could not load invoices.", variant: "destructive" });
      return;
    }
    setContext(body);
    if (!clientId && body.clients?.[0]?.id) setClientId(body.clients[0].id);
    if (!selectedInvoiceId && body.invoices?.[0]?.id) setSelectedInvoiceId(body.invoices[0].id);
    if (!rateForm.propertyId && body.properties?.[0]?.id) {
      setRateForm((prev) => ({ ...prev, propertyId: body.properties[0].id }));
    }
  }

  async function loadInvoice(id: string) {
    if (!id) {
      setSelectedInvoice(null);
      return;
    }
    const res = await fetch(`/api/admin/invoices/${id}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Invoice failed", description: body.error ?? "Could not load invoice.", variant: "destructive" });
      return;
    }
    setSelectedInvoice(body);
  }

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(() => {
    void loadInvoice(selectedInvoiceId);
  }, [selectedInvoiceId]);

  const visibleProperties = useMemo(
    () => context.properties.filter((property: any) => !clientId || property.clientId === clientId),
    [context.properties, clientId]
  );

  async function saveRate() {
    if (!rateForm.propertyId || !rateForm.baseCharge) {
      toast({ title: "Rate details required", variant: "destructive" });
      return;
    }
    setBusy("rate");
    const res = await fetch("/api/admin/property-client-rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: rateForm.propertyId,
        jobType: rateForm.jobType,
        baseCharge: Number(rateForm.baseCharge || 0),
        defaultDescription: rateForm.defaultDescription || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      toast({ title: "Rate save failed", description: body.error ?? "Could not save property rate.", variant: "destructive" });
      return;
    }
    toast({ title: "Property rate saved" });
    await loadContext();
  }

  async function generateInvoice() {
    if (!clientId) {
      toast({ title: "Client required", variant: "destructive" });
      return;
    }
    setBusy("generate");
    const res = await fetch("/api/admin/invoices/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        propertyId: propertyId || undefined,
        periodStart: periodStart ? `${periodStart}T00:00:00.000Z` : undefined,
        periodEnd: periodEnd ? `${periodEnd}T23:59:59.999Z` : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      toast({ title: "Generate failed", description: body.error ?? "Could not generate invoice.", variant: "destructive" });
      return;
    }
    toast({ title: "Invoice draft created" });
    await loadContext();
    setSelectedInvoiceId(body.id);
  }

  async function sendInvoice() {
    if (!selectedInvoiceId) return;
    setBusy("send");
    const res = await fetch(`/api/admin/invoices/${selectedInvoiceId}/send`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      toast({ title: "Send failed", description: body.error ?? "Could not send invoice.", variant: "destructive" });
      return;
    }
    toast({ title: "Invoice sent" });
    await loadContext();
    await loadInvoice(selectedInvoiceId);
  }

  async function exportXero() {
    if (!selectedInvoiceId) return;
    try {
      await downloadFromApi(`/api/admin/invoices/${selectedInvoiceId}/xero-export`, `invoice-${selectedInvoiceId}-xero.csv`, {
        method: "POST",
      });
    } catch (error: any) {
      toast({ title: "Export failed", description: error?.message ?? "Could not export invoice.", variant: "destructive" });
      return;
    }
    toast({ title: "Xero export downloaded" });
    await loadContext();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Invoices</h2>
          <p className="text-sm text-muted-foreground">
            Manage property billing rates and generate client invoices from completed jobs.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadContext()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Property client rates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
                value={rateForm.propertyId}
                onChange={(event) => setRateForm((prev) => ({ ...prev, propertyId: event.target.value }))}
              >
                <option value="">Select property</option>
                {context.properties.map((property: any) => (
                  <option key={property.id} value={property.id}>
                    {property.name} - {property.client?.name}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
                value={rateForm.jobType}
                onChange={(event) => setRateForm((prev) => ({ ...prev, jobType: event.target.value }))}
              >
                {JOB_TYPES.map((jobType) => (
                  <option key={jobType} value={jobType}>
                    {jobType.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Base charge"
                type="number"
                min="0"
                step="0.01"
                value={rateForm.baseCharge}
                onChange={(e) => setRateForm((prev) => ({ ...prev, baseCharge: e.target.value }))}
              />
              <Input
                placeholder="Default description (optional)"
                value={rateForm.defaultDescription}
                onChange={(e) => setRateForm((prev) => ({ ...prev, defaultDescription: e.target.value }))}
              />
            </div>
            <Button onClick={saveRate} disabled={busy === "rate"}>
              {busy === "rate" ? "Saving..." : "Save rate"}
            </Button>

            <div className="space-y-2 rounded-2xl border p-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading rates...</p>
              ) : context.rates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No property rates saved yet.</p>
              ) : (
                context.rates.map((rate: any) => (
                  <div key={rate.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{rate.property.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {rate.property.client?.name} · {String(rate.jobType).replace(/_/g, " ")}
                      </p>
                    </div>
                    <span className="font-medium">{money(rate.baseCharge)}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate draft invoice</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <select
              className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                setPropertyId("");
              }}
            >
              <option value="">Select client</option>
              {context.clients.map((client: any) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              <option value="">All properties</option>
              {visibleProperties.map((property: any) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            <div className="md:col-span-2">
              <Button onClick={generateInvoice} disabled={busy === "generate"}>
                {busy === "generate" ? "Generating..." : "Generate invoice"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Existing invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading invoices...</p>
            ) : context.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices created yet.</p>
            ) : (
              context.invoices.map((invoice: any) => (
                <button
                  key={invoice.id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${
                    selectedInvoiceId === invoice.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedInvoiceId(invoice.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{invoice.invoiceNumber}</span>
                    <span className="text-xs text-muted-foreground">{invoice.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {invoice.client?.name} · {money(invoice.totalAmount)}
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedInvoice ? (
              <p className="text-sm text-muted-foreground">Select an invoice to preview details.</p>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input value={selectedInvoice.invoiceNumber} disabled />
                  <Input value={`${selectedInvoice.client.name} · ${money(selectedInvoice.totalAmount)}`} disabled />
                </div>
                <div className="space-y-2 rounded-2xl border p-3">
                  {selectedInvoice.lines.map((line: any) => (
                    <div key={line.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{line.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.job?.jobNumber || line.job?.id || line.category}
                        </p>
                      </div>
                      <span className="font-medium">{money(line.lineTotal)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => downloadFromApi(`/api/admin/invoices/${selectedInvoice.id}/pdf`, `${selectedInvoice.invoiceNumber.toLowerCase()}.pdf`)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                  <Button variant="outline" onClick={sendInvoice} disabled={busy === "send"}>
                    <Mail className="mr-2 h-4 w-4" />
                    {busy === "send" ? "Sending..." : "Send"}
                  </Button>
                  <Button variant="outline" onClick={exportXero}>
                    Export Xero CSV
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
