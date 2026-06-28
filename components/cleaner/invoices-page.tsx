"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ReceiptText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

interface InvoiceRow {
  jobId: string;
  date: string;
  jobName: string;
  jobType: string;
  split: number;
  rate: number | null;
  hours: number;
  originalHours: number;
  isHoursOverridden: boolean;
  hoursChangeNote?: string;
  spentHours: number | null;
  baseAmount: number;
  approvedExtraAmount: number;
  transportAllowance: number;
  amount: number;
  comment?: string;
}

interface InvoicePreview {
  hours: number;
  estimatedPay: number;
  rows: InvoiceRow[];
  expenseRows?: Array<{
    runId: string;
    date: string;
    runName: string;
    properties: string;
    amount: number;
    paymentMethod: string;
    note?: string;
  }>;
  expenseTotal?: number;
  shoppingTimeRows?: Array<{
    runId: string;
    date: string;
    runName: string;
    properties: string;
    minutes: number;
    hourlyRate: number;
    amount: number;
    note?: string;
  }>;
  shoppingTimeTotal?: number;
  pendingAdjustmentCount?: number;
  pendingAdjustmentAmount?: number;
}

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

// Quick-range presets. Each returns ISO yyyy-mm-dd strings using local time so the
// date the cleaner sees matches the date pickers (which are also local).
function isoLocal(d: Date) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function presetRange(kind: "thisMonth" | "lastMonth" | "last2Weeks"): { start: string; end: string } {
  const now = new Date();
  if (kind === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: isoLocal(start), end: isoLocal(now) };
  }
  if (kind === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: isoLocal(start), end: isoLocal(end) };
  }
  // last 2 weeks (inclusive of today)
  const start = new Date(now);
  start.setDate(start.getDate() - 13);
  return { start: isoLocal(start), end: isoLocal(now) };
}

export function CleanerInvoicesPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showSpentHours, setShowSpentHours] = useState(true);
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [invoiceDownloading, setInvoiceDownloading] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<InvoicePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [jobComments, setJobComments] = useState<Record<string, string>>({});
  const [previewPdfUrl, setPreviewPdfUrl] = useState("");
  const [previewingPdf, setPreviewingPdf] = useState(false);
  const [emailReviewOpen, setEmailReviewOpen] = useState(false);
  const [jobHourOverridesInput, setJobHourOverridesInput] = useState<Record<string, string>>({});
  const [missingProfileFields, setMissingProfileFields] = useState<Array<{ key: string; label: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me/profile-completeness");
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && Array.isArray(body.missing)) setMissingProfileFields(body.missing);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const payableJobs = useMemo(() => invoicePreview?.rows ?? [], [invoicePreview]);

  // Derived breakdown for the summary tiles. We sum the row fields the preview
  // returns (no new money logic) so the tiles reconcile against the grand total.
  const breakdown = useMemo(() => {
    const rows = invoicePreview?.rows ?? [];
    let jobsSubtotal = 0;
    let extraPayments = 0;
    let transport = 0;
    for (const row of rows) {
      jobsSubtotal += Number(row.baseAmount ?? 0);
      extraPayments += Number(row.approvedExtraAmount ?? 0);
      transport += Number(row.transportAllowance ?? 0);
    }
    return {
      jobsSubtotal,
      extraPayments,
      transport,
      shoppingTime: Number(invoicePreview?.shoppingTimeTotal ?? 0),
    };
  }, [invoicePreview]);

  function buildInvoicePayload() {
    const cleanedComments = Object.fromEntries(
      Object.entries(jobComments)
        .map(([id, comment]) => [id, comment.trim()])
        .filter(([, comment]) => comment.length > 0)
    );
    const cleanedHourOverrides = Object.fromEntries(
      Object.entries(jobHourOverridesInput)
        .map(([id, value]) => [id, Number(value)] as const)
        .filter(([, value]) => Number.isFinite(value) && value >= 0)
    );

    return {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      showSpentHours,
      jobComments: cleanedComments,
      jobHourOverrides: cleanedHourOverrides,
    };
  }

  async function loadInvoicePreview() {
    setLoadingPreview(true);
    const res = await fetch("/api/cleaner/invoice/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInvoicePayload()),
    });
    const body = await res.json().catch(() => ({}));
    setLoadingPreview(false);
    if (!res.ok) {
      toast({
        title: "Preview failed",
        description: body.error ?? "Could not load invoice preview.",
        variant: "destructive",
      });
      return;
    }

    setInvoicePreview(body);
    setJobComments((prev) => {
      const next = { ...prev };
      for (const row of body.rows ?? []) {
        if (typeof next[row.jobId] !== "string") {
          next[row.jobId] = row.comment ?? "";
        }
      }
      return next;
    });
    setJobHourOverridesInput((prev) => {
      const next = { ...prev };
      for (const row of body.rows ?? []) {
        if (typeof next[row.jobId] !== "string" || next[row.jobId].trim() === "") {
          next[row.jobId] = Number(row.hours ?? row.originalHours ?? 0).toFixed(2);
        }
      }
      return next;
    });
  }

  useEffect(() => {
    loadInvoicePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, showSpentHours]);

  useEffect(
    () => () => {
      if (previewPdfUrl) {
        window.URL.revokeObjectURL(previewPdfUrl);
      }
    },
    [previewPdfUrl]
  );

  async function sendInvoice() {
    setInvoiceSending(true);
    const res = await fetch("/api/cleaner/invoice/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...buildInvoicePayload(),
        confirmEmail: true,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setInvoiceSending(false);
    if (!res.ok) {
      toast({ title: "Invoice failed", description: body.error ?? "Could not send invoice.", variant: "destructive" });
      return;
    }
    setEmailReviewOpen(false);
    toast({
      title: "Invoice sent",
      description: `Sent to ${body.sentTo}. Paid Hours: ${Number(body.hours ?? 0).toFixed(2)}, Est: ${money(body.estimatedPay)}`,
    });
  }

  async function previewInvoicePdf() {
    setPreviewingPdf(true);
    const res = await fetch("/api/cleaner/invoice/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInvoicePayload()),
    });
    setPreviewingPdf(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({
        title: "Preview failed",
        description:
          body.error ??
          "Could not generate invoice PDF preview. Ensure Playwright browsers are installed.",
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    if (previewPdfUrl) {
      window.URL.revokeObjectURL(previewPdfUrl);
    }
    const url = window.URL.createObjectURL(blob);
    setPreviewPdfUrl(url);
    setEmailReviewOpen(true);
  }

  async function openEmailPreviewFlow() {
    await loadInvoicePreview();
    await previewInvoicePdf();
  }

  async function downloadInvoice() {
    setInvoiceDownloading(true);
    const res = await fetch("/api/cleaner/invoice/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInvoicePayload()),
    });
    setInvoiceDownloading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Download failed", description: body.error ?? "Could not download invoice PDF.", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleaner-invoice-${startDate || "month-start"}-to-${endDate || "today"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  function applyPreset(kind: "thisMonth" | "lastMonth" | "last2Weeks") {
    const range = presetRange(kind);
    setStartDate(range.start);
    setEndDate(range.end);
  }

  const hasPendingAwaitingApproval =
    Number(invoicePreview?.estimatedPay ?? 0) <= 0 && Number(invoicePreview?.pendingAdjustmentCount ?? 0) > 0;

  const expenseRows = invoicePreview?.expenseRows ?? [];
  const shoppingTimeRows = invoicePreview?.shoppingTimeRows ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader
        title="Invoices"
        description="Pick a period, review your paid hours, then download or email your invoice."
        icon={<ReceiptText />}
      />

      {missingProfileFields.length > 0 ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          <p className="font-medium">Complete your profile before emailing an invoice.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your invoice must include these details: {missingProfileFields.map((f) => f.label).join(", ")}.
          </p>
          <Link
            href="/cleaner/profile"
            className="mt-2 inline-block rounded-lg border border-warning/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-warning/10"
          >
            Complete profile
          </Link>
        </div>
      ) : null}

      {/* ---------- Period selector ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Choose a period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset("thisMonth")}>
              This month
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset("lastMonth")}>
              Last month
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset("last2Weeks")}>
              Last 2 weeks
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-start" className="text-xs text-muted-foreground">
                Start date (optional)
              </Label>
              <Input
                id="invoice-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-end" className="text-xs text-muted-foreground">
                End date (optional)
              </Label>
              <Input
                id="invoice-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch checked={showSpentHours} onCheckedChange={setShowSpentHours} />
              Show hours spent
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={loadInvoicePreview}
              disabled={loadingPreview}
            >
              {loadingPreview ? "Refreshing…" : "Refresh preview"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Summary header ---------- */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total to invoice
            </span>
            <span className="text-3xl font-semibold tabular-nums text-foreground">
              {loadingPreview && !invoicePreview ? "—" : money(invoicePreview?.estimatedPay)}
            </span>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">
                Paid hours: {Number(invoicePreview?.hours ?? 0).toFixed(2)}
              </Badge>
              <Badge variant="secondary">Jobs: {payableJobs.length}</Badge>
              {Number(invoicePreview?.pendingAdjustmentCount ?? 0) > 0 ? (
                <Badge variant="warning">
                  Pending approvals: {Number(invoicePreview?.pendingAdjustmentCount ?? 0)} (
                  {money(invoicePreview?.pendingAdjustmentAmount)})
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border bg-surface p-3">
              <p className="text-[11px] text-muted-foreground">Jobs subtotal</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{money(breakdown.jobsSubtotal)}</p>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <p className="text-[11px] text-muted-foreground">Extra payments</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{money(breakdown.extraPayments)}</p>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <p className="text-[11px] text-muted-foreground">Shopping time</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{money(breakdown.shoppingTime)}</p>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <p className="text-[11px] text-muted-foreground">Transport</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{money(breakdown.transport)}</p>
            </div>
          </div>

          {Number(invoicePreview?.expenseTotal ?? 0) > 0 ? (
            <p className="text-xs text-muted-foreground">
              Plus shopping reimbursements: {money(invoicePreview?.expenseTotal)} (listed below).
            </p>
          ) : null}

          {hasPendingAwaitingApproval ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Emailing is blocked while the total is $0.00 and pending extra payment approvals exist.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------- Per-job list ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Jobs in this period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingPreview && !invoicePreview ? (
            <p className="text-sm text-muted-foreground">Loading invoice preview…</p>
          ) : !invoicePreview ? (
            <p className="text-sm text-muted-foreground">No preview available.</p>
          ) : payableJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payable jobs in the selected range.</p>
          ) : (
            payableJobs.map((row) => {
              const overrideRaw = jobHourOverridesInput[row.jobId];
              const effectiveHours = Number(overrideRaw ?? row.hours);
              const isChanged = effectiveHours !== Number(row.originalHours);
              return (
                <div key={row.jobId} className="rounded-xl border bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{row.jobName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {row.date} · {row.jobType} · Split {row.split}
                        {row.rate != null ? ` · Rate ${money(row.rate)}` : " · Rate not set"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-foreground">{money(row.amount)}</p>
                      <p className="text-[11px] text-muted-foreground">line total</p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>Paid: {row.hours.toFixed(2)}h</span>
                    {showSpentHours ? <span>Spent: {(row.spentHours ?? 0).toFixed(2)}h</span> : null}
                    <span>Extra: {money(row.approvedExtraAmount)}</span>
                    {row.transportAllowance > 0 ? <span>Transport: {money(row.transportAllowance)}</span> : null}
                    {row.isHoursOverridden && row.hoursChangeNote ? (
                      <span>Changed: {row.hoursChangeNote}</span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`hours-${row.jobId}`}
                        className="text-[11px] font-medium text-muted-foreground"
                      >
                        Paid hours override
                      </Label>
                      <Input
                        id={`hours-${row.jobId}`}
                        type="number"
                        min="0"
                        step="0.25"
                        value={jobHourOverridesInput[row.jobId] ?? ""}
                        onChange={(e) =>
                          setJobHourOverridesInput((prev) => ({
                            ...prev,
                            [row.jobId]: e.target.value,
                          }))
                        }
                      />
                      {isChanged ? (
                        <p className="text-[11px] text-warning">
                          {Number(row.originalHours).toFixed(2)}h {"->"} {effectiveHours.toFixed(2)}h — tap
                          “Refresh preview” to recalculate.
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`comment-${row.jobId}`}
                        className="text-[11px] font-medium text-muted-foreground"
                      >
                        Comment (optional)
                      </Label>
                      <Textarea
                        id={`comment-${row.jobId}`}
                        className="min-h-[40px]"
                        placeholder="Note shown on this job line in the invoice"
                        value={jobComments[row.jobId] ?? ""}
                        onChange={(e) =>
                          setJobComments((prev) => ({
                            ...prev,
                            [row.jobId]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ---------- Extra: shopping reimbursements ---------- */}
      {expenseRows.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Shopping reimbursements · {money(invoicePreview?.expenseTotal)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {expenseRows.map((row) => (
              <div key={row.runId} className="rounded-lg border border-success/40 bg-success/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{row.runName}</p>
                  <p className="text-sm font-semibold tabular-nums">{money(row.amount)}</p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {row.date} · {row.properties} · {row.paymentMethod}
                </p>
                {row.note ? <p className="mt-1 text-[11px] text-muted-foreground">{row.note}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- Shopping time ---------- */}
      {shoppingTimeRows.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Shopping time · {money(invoicePreview?.shoppingTimeTotal)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {shoppingTimeRows.map((row) => (
              <div key={`time-${row.runId}`} className="rounded-lg border border-info/30 bg-info/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{row.runName}</p>
                  <p className="text-sm font-semibold tabular-nums">{money(row.amount)}</p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {row.date} · {row.properties} · {row.minutes} min · Rate {money(row.hourlyRate)}
                </p>
                {row.note ? <p className="mt-1 text-[11px] text-muted-foreground">{row.note}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- Actions ---------- */}
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button onClick={downloadInvoice} disabled={invoiceDownloading} className="w-full" variant="outline">
              {invoiceDownloading ? "Generating…" : "Download invoice PDF"}
            </Button>
            <Button
              onClick={openEmailPreviewFlow}
              disabled={invoiceSending || previewingPdf || hasPendingAwaitingApproval || missingProfileFields.length > 0}
              className="w-full"
            >
              {previewingPdf ? "Opening preview…" : invoiceSending ? "Sending…" : "Email invoice to accounts"}
            </Button>
          </div>
          <Button onClick={loadInvoicePreview} variant="ghost" className="w-full text-xs">
            Refresh totals
          </Button>
        </CardContent>
      </Card>

      <Dialog open={emailReviewOpen} onOpenChange={setEmailReviewOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review Invoice PDF</DialogTitle>
          </DialogHeader>
          {previewPdfUrl ? (
            <>
              {/* Desktop browsers render PDFs inline; mobile browsers (iOS Safari,
                  Android Chrome) do NOT render a blob: PDF inside an iframe, so the
                  inline preview is hidden on small screens in favour of an explicit
                  "Open PDF" action that hands the file to the phone's native viewer. */}
              <iframe
                src={previewPdfUrl}
                title="Invoice PDF preview"
                className="hidden h-[70vh] w-full rounded border sm:block"
              />
              <div className="rounded-md border bg-muted/30 p-4 text-center sm:hidden">
                <p className="mb-3 text-sm text-muted-foreground">
                  Your invoice PDF is ready. Tap below to open it in your phone&apos;s PDF viewer.
                </p>
                <Button asChild className="w-full">
                  <a href={previewPdfUrl} target="_blank" rel="noreferrer">
                    Open PDF
                  </a>
                </Button>
              </div>
              <a
                href={previewPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-xs text-muted-foreground underline sm:hidden"
              >
                Preview not showing? Open in a new tab
              </a>
              <a
                href={previewPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden text-center text-xs text-muted-foreground underline sm:block"
              >
                Open PDF in a new tab
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No preview available.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => setEmailReviewOpen(false)}>
              Back to edit
            </Button>
            <Button onClick={sendInvoice} disabled={invoiceSending || hasPendingAwaitingApproval}>
              {invoiceSending ? "Emailing…" : "Approve and Email"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
