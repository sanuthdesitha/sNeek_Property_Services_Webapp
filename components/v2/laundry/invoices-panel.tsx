"use client";

/**
 * Estate laundry invoices tool. Same endpoints + payloads as the live workspace
 * (components/laundry/invoices-page.tsx):
 *   GET  /api/laundry/invoice/preview?period=…&anchorDate|startDate/endDate&propertyId
 *   PATCH /api/laundry/invoice/template  { companyName, invoiceTitle, footerNote }
 *   POST /api/laundry/invoice/download   { period, anchorDate|startDate/endDate,
 *                                          propertyId?, template }  → PDF blob
 */
import { useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { Download, ReceiptText, RefreshCw } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/cleaner/fields";
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

export function InvoicesPanel({ properties }: { properties: PropertyOption[] }) {
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
      return `${format(start, "dd MMM")} – ${format(end, "dd MMM yyyy")} (Weekly)`;
    }
    if (period === "monthly") {
      return `${format(startOfMonth(anchor), "dd MMM")} – ${format(endOfMonth(anchor), "dd MMM yyyy")} (Monthly)`;
    }
    return `${customStart} – ${customEnd} (Custom)`;
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
    setTemplate((prev) => ({ ...((prev ?? {}) as LaundryInvoiceTemplate), ...(body.template ?? {}) }));
  }

  useEffect(() => {
    void loadPreview();
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

  function setTpl(patch: Partial<LaundryInvoiceTemplate>) {
    setTemplate((prev) => ({ ...(prev ?? { companyName: "", invoiceTitle: "", footerNote: "" }), ...patch }));
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <EButton variant="outline" size="sm" onClick={() => void loadPreview()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh preview"}
        </EButton>
        <EButton variant="gold" size="sm" onClick={() => void downloadPdf()} disabled={downloading || !template}>
          <Download className="h-4 w-4" />
          {downloading ? "Generating…" : "Download PDF"}
        </EButton>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Filters */}
        <ECard className="xl:col-span-2">
          <ECardHeader>
            <ECardTitle>Invoice filters</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <EField label="Period">
                <ESelect value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom</option>
                </ESelect>
              </EField>
              <EField label="Property">
                <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="all">All properties</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name} ({property.suburb})
                    </option>
                  ))}
                </ESelect>
              </EField>
              {period !== "custom" ? (
                <EField label="Anchor date" className="sm:col-span-2">
                  <EInput type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
                </EField>
              ) : (
                <>
                  <EField label="Start date">
                    <EInput type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                  </EField>
                  <EField label="End date">
                    <EInput type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                  </EField>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <p className="text-[0.875rem] font-[550]">{computedRangeLabel}</p>
              <label className="flex items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                <ESwitch checked={showFullView} onCheckedChange={setShowFullView} aria-label="Full job breakdown" />
                Full job breakdown
              </label>
            </div>
          </ECardBody>
        </ECard>

        {/* Template */}
        <ECard>
          <ECardHeader>
            <ECardTitle>Invoice template</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <EField label="Laundry company name">
              <EInput
                value={template?.companyName ?? ""}
                onChange={(e) => setTpl({ companyName: e.target.value })}
                placeholder="Your Laundry Company Pty Ltd"
              />
            </EField>
            <EField label="Invoice title">
              <EInput
                value={template?.invoiceTitle ?? ""}
                onChange={(e) => setTpl({ invoiceTitle: e.target.value })}
                placeholder="Laundry Services Invoice"
              />
            </EField>
            <EField label="Footer note">
              <ETextarea
                value={template?.footerNote ?? ""}
                onChange={(e) => setTpl({ footerNote: e.target.value })}
                placeholder="Payment terms or notes"
              />
            </EField>
            <EButton
              variant="outline"
              className="w-full"
              onClick={() => void saveTemplate()}
              disabled={savingTemplate || !template}
            >
              {savingTemplate ? "Saving…" : "Save template"}
            </EButton>
          </ECardBody>
        </ECard>
      </div>

      {/* KPI row */}
      <section className="grid gap-3 sm:grid-cols-3">
        <EStatCard label="Jobs in invoice" value={data?.rows.length ?? 0} icon={<ReceiptText className="h-4 w-4" />} />
        <EStatCard label="Properties" value={data?.propertyBreakdown.length ?? 0} />
        <EStatCard label="Invoice total" value={money(data?.totalAmount ?? 0)} />
      </section>

      {/* Property breakdown */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Property breakdown</ECardTitle>
        </ECardHeader>
        <ECardBody>
          {!data || data.propertyBreakdown.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing here"
              title="No returned laundry jobs"
              description="No returned laundry jobs found in the selected period."
            />
          ) : (
            <div className="space-y-2">
              {data.propertyBreakdown.map((item) => (
                <div
                  key={item.propertyId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3"
                >
                  <div>
                    <p className="text-[0.875rem] font-[550]">{item.propertyName}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.suburb}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <EBadge tone="neutral" soft>
                      {item.jobs} jobs
                    </EBadge>
                    <span className="e-numeral text-[1.125rem] leading-none">{money(item.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Job breakdown */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Job breakdown</ECardTitle>
        </ECardHeader>
        <ECardBody>
          {!data || data.rows.length === 0 ? (
            <EEmptyState eyebrow="Empty" title="No jobs to invoice" description="No jobs to invoice for this selection." />
          ) : showFullView ? (
            <div className="space-y-2">
              {data.rows.map((row) => (
                <div
                  key={row.taskId}
                  className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[0.875rem] font-[550]">{row.propertyName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.suburb}</p>
                    </div>
                    <div className="text-right">
                      <p className="e-numeral text-[1.125rem] leading-none">{money(row.amount)}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {row.status.replace(/_/g, " ")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:grid-cols-2 lg:grid-cols-4">
                    <p>Service: {format(new Date(row.serviceDate), "dd MMM yyyy")}</p>
                    <p>Pickup: {format(new Date(row.pickupDate), "dd MMM yyyy")}</p>
                    <p>Return: {format(new Date(row.dropoffDate), "dd MMM yyyy")}</p>
                    <p>Bags: {row.bagCount ?? "-"}</p>
                    <p className="sm:col-span-2">Drop-off: {row.dropoffLocation ?? "-"}</p>
                    <p className="sm:col-span-2">Notes: {row.notes ?? "-"}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ETableShell
              headers={[
                { label: "Property" },
                { label: "Service" },
                { label: "Pickup" },
                { label: "Return" },
                { label: "Bags", align: "right" },
                { label: "Location" },
                { label: "Amount", align: "right" },
              ]}
            >
              {data.rows.map((row) => (
                <tr key={row.taskId}>
                  <td className="px-4 py-3">{row.propertyName}</td>
                  <td className="px-4 py-3">{format(new Date(row.serviceDate), "dd MMM yyyy")}</td>
                  <td className="px-4 py-3">{format(new Date(row.pickupDate), "dd MMM yyyy")}</td>
                  <td className="px-4 py-3">{format(new Date(row.dropoffDate), "dd MMM yyyy")}</td>
                  <td className="e-tnum px-4 py-3 text-right">{row.bagCount ?? "-"}</td>
                  <td className="px-4 py-3">{row.dropoffLocation ?? "-"}</td>
                  <td className="e-tnum px-4 py-3 text-right">{money(row.amount)}</td>
                </tr>
              ))}
            </ETableShell>
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
