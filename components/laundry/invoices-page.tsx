"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type Period = "daily" | "weekly" | "monthly" | "custom";

interface PropertyOption {
  id: string;
  name: string;
  suburb: string;
}

interface LaundryInvoiceTemplate {
  companyName: string;
  invoiceTitle: string;
  footerNote: string;
}

interface LaundryInvoiceRow {
  taskId: string;
  jobId: string;
  propertyId: string;
  propertyName: string;
  suburb: string;
  serviceDate: string;
  pickupDate: string;
  dropoffDate: string;
  droppedAt: string;
  bagCount: number | null;
  dropoffLocation: string | null;
  amount: number;
  notes: string | null;
  status: string;
}

interface LaundryInvoiceData {
  period: Period;
  start: string;
  end: string;
  propertyId?: string;
  propertyName?: string | null;
  rows: LaundryInvoiceRow[];
  totalAmount: number;
  propertyBreakdown: Array<{ propertyId: string; propertyName: string; suburb: string; jobs: number; amount: number }>;
}

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function dateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function LaundryInvoicesPage({ properties }: { properties: PropertyOption[] }) {
  const now = new Date();
  const [period, setPeriod] = useState<Period>("weekly");
  const [anchorDate, setAnchorDate] = useState(dateStr(now));
  const [customStart, setCustomStart] = useState(dateStr(startOfWeek(now, { weekStartsOn: 1 })));
  const [customEnd, setCustomEnd] = useState(dateStr(endOfWeek(now, { weekStartsOn: 1 })));
  const [propertyId, setPropertyId] = useState<string>("all");
  const [showFullView, setShowFullView] = useState(true);
  const [template, setTemplate] = useState<LaundryInvoiceTemplate | null>(null);
  const [data, setData] = useState<LaundryInvoiceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const computedRangeLabel = useMemo(() => {
    const anchor = new Date(`${anchorDate}T00:00:00`);
    if (period === "daily") return `${format(anchor, "dd MMM yyyy")} (Daily)`;
    if (period === "weekly") {
      const start = startOfWeek(anchor, { weekStartsOn: 1 });
      const end = addDays(start, 6);
      return `${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")} (Weekly)`;
    }
    if (period === "monthly") {
      return `${format(startOfMonth(anchor), "dd MMM")} - ${format(endOfMonth(anchor), "dd MMM yyyy")} (Monthly)`;
    }
    return `${customStart} - ${customEnd} (Custom)`;
  }, [period, anchorDate, customStart, customEnd]);

  function buildQuery() {
    const q = new URLSearchParams();
    q.set("period", period);
    if (period === "custom") {
      if (customStart) q.set("startDate", customStart);
      if (customEnd) q.set("endDate", customEnd);
    } else if (anchorDate) {
      q.set("anchorDate", anchorDate);
    }
    if (propertyId !== "all") q.set("propertyId", propertyId);
    return q.toString();
  }

  async function loadPreview() {
    setLoading(true);
    const res = await fetch(`/api/laundry/invoice/preview?${buildQuery()}`);
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Preview failed", description: body.error ?? "Could not load invoice preview.", variant: "destructive" });
      return;
    }
    setData(body.data ?? null);
    setTemplate((prev) => ({ ...(prev ?? {} as LaundryInvoiceTemplate), ...(body.template ?? {}) }));
  }

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, anchorDate, customStart, customEnd, propertyId]);

  async function saveTemplate() {
    if (!template) return;
    setSavingTemplate(true);
    const res = await fetch("/api/laundry/invoice/template", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    });
    const body = await res.json().catch(() => ({}));
    setSavingTemplate(false);
    if (!res.ok) {
      toast({ title: "Template save failed", description: body.error ?? "Could not save template.", variant: "destructive" });
      return;
    }
    setTemplate(body);
    toast({ title: "Invoice template saved" });
  }

  async function downloadPdf() {
    if (!template) return;
    setDownloading(true);
    const res = await fetch("/api/laundry/invoice/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period,
        ...(period === "custom" ? { startDate: customStart, endDate: customEnd } : { anchorDate }),
        ...(propertyId !== "all" ? { propertyId } : {}),
        template,
      }),
    });
    setDownloading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Download failed", description: body.error ?? "Could not generate PDF.", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laundry-invoice-${period}-${propertyId === "all" ? "all" : propertyId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Laundry Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Create invoices by property and date range (daily, weekly, monthly, or custom) with job-level price breakdown.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadPreview} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Preview"}
          </Button>
          <Button onClick={downloadPdf} disabled={downloading || !template}>
            {downloading ? "Generating PDF..." : "Download PDF"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Invoice Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Period</Label>
                <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Property</Label>
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All properties</SelectItem>
                    {properties.map((property) => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.name} ({property.suburb})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {period !== "custom" ? (
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Anchor date</Label>
                  <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start date</Label>
                    <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">End date</Label>
                    <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <p className="text-sm">{computedRangeLabel}</p>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={showFullView} onCheckedChange={setShowFullView} />
                Full job breakdown
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Invoice Template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Laundry company name</Label>
              <Input
                value={template?.companyName ?? ""}
                onChange={(e) => setTemplate((prev) => ({ ...(prev ?? { companyName: "", invoiceTitle: "", footerNote: "" }), companyName: e.target.value }))}
                placeholder="Your Laundry Company Pty Ltd"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Invoice title</Label>
              <Input
                value={template?.invoiceTitle ?? ""}
                onChange={(e) => setTemplate((prev) => ({ ...(prev ?? { companyName: "", invoiceTitle: "", footerNote: "" }), invoiceTitle: e.target.value }))}
                placeholder="Laundry Services Invoice"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Footer note</Label>
              <Textarea
                value={template?.footerNote ?? ""}
                onChange={(e) => setTemplate((prev) => ({ ...(prev ?? { companyName: "", invoiceTitle: "", footerNote: "" }), footerNote: e.target.value }))}
                placeholder="Payment terms or notes"
              />
            </div>
            <Button onClick={saveTemplate} disabled={savingTemplate || !template} className="w-full" variant="outline">
              {savingTemplate ? "Saving..." : "Save Template"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Jobs in invoice</p>
            <p className="text-2xl font-bold">{data?.rows.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Properties</p>
            <p className="text-2xl font-bold">{data?.propertyBreakdown.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Invoice total</p>
            <p className="text-2xl font-bold">{money(data?.totalAmount ?? 0)}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Property Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.propertyBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No returned laundry jobs found in the selected period.</p>
          ) : (
            <div className="space-y-2">
              {data.propertyBreakdown.map((item) => (
                <div key={item.propertyId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
                  <div>
                    <p className="font-medium text-sm">{item.propertyName}</p>
                    <p className="text-xs text-muted-foreground">{item.suburb}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{item.jobs} jobs</Badge>
                    <span className="text-sm font-semibold">{money(item.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Job Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs to invoice for this selection.</p>
          ) : showFullView ? (
            <div className="space-y-2">
              {data.rows.map((row) => (
                <div key={row.taskId} className="rounded border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{row.propertyName}</p>
                      <p className="text-xs text-muted-foreground">{row.suburb}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{money(row.amount)}</p>
                      <p className="text-xs text-muted-foreground">{row.status.replace(/_/g, " ")}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                    <p>Service date: {format(new Date(row.serviceDate), "dd MMM yyyy")}</p>
                    <p>Pickup: {format(new Date(row.pickupDate), "dd MMM yyyy")}</p>
                    <p>Return: {format(new Date(row.dropoffDate), "dd MMM yyyy")}</p>
                    <p>Bags: {row.bagCount ?? "-"}</p>
                    <p className="sm:col-span-2 lg:col-span-2">Drop-off location: {row.dropoffLocation ?? "-"}</p>
                    <p className="sm:col-span-2 lg:col-span-2">Notes: {row.notes ?? "-"}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">Property</th>
                    <th className="px-2 py-2">Service</th>
                    <th className="px-2 py-2">Pickup</th>
                    <th className="px-2 py-2">Return</th>
                    <th className="px-2 py-2 text-right">Bags</th>
                    <th className="px-2 py-2">Location</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.taskId} className="border-b last:border-0">
                      <td className="px-2 py-2">{row.propertyName}</td>
                      <td className="px-2 py-2">{format(new Date(row.serviceDate), "dd MMM yyyy")}</td>
                      <td className="px-2 py-2">{format(new Date(row.pickupDate), "dd MMM yyyy")}</td>
                      <td className="px-2 py-2">{format(new Date(row.dropoffDate), "dd MMM yyyy")}</td>
                      <td className="px-2 py-2 text-right">{row.bagCount ?? "-"}</td>
                      <td className="px-2 py-2">{row.dropoffLocation ?? "-"}</td>
                      <td className="px-2 py-2 text-right">{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
