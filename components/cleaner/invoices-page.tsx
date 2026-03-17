"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  pendingAdjustmentCount?: number;
  pendingAdjustmentAmount?: number;
}

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
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

  const payableJobs = useMemo(() => invoicePreview?.rows ?? [], [invoicePreview]);

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

  const hasPendingAwaitingApproval =
    Number(invoicePreview?.estimatedPay ?? 0) <= 0 && Number(invoicePreview?.pendingAdjustmentCount ?? 0) > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Preview paid hours, add job comments, download invoice PDF, and email to accounts.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Invoice (Allocated Hours + Approved Extras)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs text-muted-foreground">Start date (optional)</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">End date (optional)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={showSpentHours} onCheckedChange={setShowSpentHours} />
                Show hours spent column
              </label>
            </div>
          </div>

          <div className="rounded-md border p-2">
            {loadingPreview ? (
              <p className="text-sm text-muted-foreground">Loading invoice preview...</p>
            ) : !invoicePreview ? (
              <p className="text-sm text-muted-foreground">No preview available.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-3 text-xs">
                  <Badge variant="secondary">Paid Hours: {Number(invoicePreview.hours ?? 0).toFixed(2)}</Badge>
                  <Badge variant="secondary">Estimated Pay: {money(invoicePreview.estimatedPay)}</Badge>
                  <Badge variant="secondary">Jobs: {invoicePreview.rows.length}</Badge>
                  {Number(invoicePreview.pendingAdjustmentCount ?? 0) > 0 ? (
                    <Badge variant="warning">
                      Pending approvals: {Number(invoicePreview.pendingAdjustmentCount ?? 0)} ({money(invoicePreview.pendingAdjustmentAmount)})
                    </Badge>
                  ) : null}
                </div>
                {hasPendingAwaitingApproval ? (
                  <p className="text-xs text-destructive">
                    Invoice email is blocked while total is $0.00 and pending extra payment approvals exist.
                  </p>
                ) : null}

                <div className="max-h-[60vh] space-y-2 overflow-auto">
                  {payableJobs.map((row) => (
                    <div key={row.jobId} className="rounded border p-2">
                      <p className="text-xs font-medium">{row.jobName} - {row.jobType}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {row.date} | Paid: {row.hours.toFixed(2)}h | Split: {row.split}
                        {row.rate != null ? ` | Rate: ${money(row.rate)}` : " | Rate: Not set"}
                        {showSpentHours ? ` | Spent: ${(row.spentHours ?? 0).toFixed(2)}h` : ""}
                        {` | Extra: ${money(row.approvedExtraAmount)}`}
                        {row.transportAllowance > 0 ? ` | Transport: ${money(row.transportAllowance)}` : ""}
                        {` | Total: ${money(row.amount)}`}
                        {row.isHoursOverridden && row.hoursChangeNote ? ` | Changed: ${row.hoursChangeNote}` : ""}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <Label className="text-[11px] text-muted-foreground">Paid hours override</Label>
                          <Input
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
                        </div>
                        {Number(jobHourOverridesInput[row.jobId] ?? row.hours) !== Number(row.originalHours) ? (
                          <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                            Hours changed: {Number(row.originalHours).toFixed(2)} {"->"} {Number(jobHourOverridesInput[row.jobId] ?? row.hours).toFixed(2)}
                          </div>
                        ) : null}
                      </div>
                      <Textarea
                        className="mt-2"
                        placeholder="Optional comment for this job in invoice"
                        value={jobComments[row.jobId] ?? ""}
                        onChange={(e) =>
                          setJobComments((prev) => ({
                            ...prev,
                            [row.jobId]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                  {payableJobs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No payable jobs in selected range.</p>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Button onClick={downloadInvoice} disabled={invoiceDownloading} className="w-full" variant="outline">
              {invoiceDownloading ? "Generating..." : "Download Invoice PDF"}
            </Button>
            <Button
              onClick={openEmailPreviewFlow}
              disabled={invoiceSending || previewingPdf || hasPendingAwaitingApproval}
              className="w-full"
            >
              {previewingPdf ? "Opening preview..." : invoiceSending ? "Sending..." : "Email Invoice To Accounts"}
            </Button>
          </div>
          <Button onClick={loadInvoicePreview} variant="ghost" className="w-full text-xs">Refresh totals</Button>
        </CardContent>
      </Card>

      <Dialog open={emailReviewOpen} onOpenChange={setEmailReviewOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review Invoice PDF</DialogTitle>
          </DialogHeader>
          {previewPdfUrl ? (
            <iframe src={previewPdfUrl} title="Invoice PDF preview" className="h-[70vh] w-full rounded border" />
          ) : (
            <p className="text-sm text-muted-foreground">No preview available.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => setEmailReviewOpen(false)}>
              Back to edit
            </Button>
            <Button onClick={sendInvoice} disabled={invoiceSending || hasPendingAwaitingApproval}>
              {invoiceSending ? "Emailing..." : "Approve and Email"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
