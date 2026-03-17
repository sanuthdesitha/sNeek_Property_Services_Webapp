"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { toast } from "@/hooks/use-toast";

interface JobOption {
  id: string;
  label: string;
}

interface DashboardToolsProps {
  jobs: JobOption[];
}

interface InvoiceRow {
  jobId: string;
  date: string;
  jobName: string;
  jobType: string;
  split: number;
  rate: number | null;
  hours: number;
  spentHours: number | null;
  baseAmount: number;
  approvedExtraAmount: number;
  amount: number;
  comment?: string;
}

interface InvoicePreview {
  hours: number;
  estimatedPay: number;
  rows: InvoiceRow[];
}

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export function CleanerDashboardTools({ jobs }: DashboardToolsProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showSpentHours, setShowSpentHours] = useState(true);
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [invoiceDownloading, setInvoiceDownloading] = useState(false);
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<InvoicePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [jobComments, setJobComments] = useState<Record<string, string>>({});

  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [itemName, setItemName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [savingLostFound, setSavingLostFound] = useState(false);

  const [payRequests, setPayRequests] = useState<any[]>([]);
  const [loadingPayRequests, setLoadingPayRequests] = useState(false);
  const [savingPayRequest, setSavingPayRequest] = useState(false);
  const [payJobId, setPayJobId] = useState<string>(jobs[0]?.id ?? "");
  const [payType, setPayType] = useState<"HOURLY" | "FIXED">("HOURLY");
  const [payHours, setPayHours] = useState("1");
  const [payRate, setPayRate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [extraPaymentRequired, setExtraPaymentRequired] = useState(false);

  const payableJobs = useMemo(() => invoicePreview?.rows ?? [], [invoicePreview]);

  async function loadInvoicePreview() {
    setLoadingPreview(true);
    const query = new URLSearchParams();
    if (startDate) query.set("startDate", startDate);
    if (endDate) query.set("endDate", endDate);
    if (showSpentHours) query.set("showSpentHours", "true");
    const res = await fetch(`/api/cleaner/invoice/preview?${query.toString()}`);
    const body = await res.json().catch(() => ({}));
    setLoadingPreview(false);
    if (!res.ok) {
      toast({ title: "Preview failed", description: body.error ?? "Could not load invoice preview.", variant: "destructive" });
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

    if (!payJobId && Array.isArray(body.rows) && body.rows[0]?.jobId) {
      setPayJobId(body.rows[0].jobId);
    }
  }

  async function loadPayRequests() {
    setLoadingPayRequests(true);
    const res = await fetch("/api/cleaner/pay-adjustments");
    const body = await res.json().catch(() => []);
    setLoadingPayRequests(false);
    setPayRequests(Array.isArray(body) ? body : []);
  }

  useEffect(() => {
    loadInvoicePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, showSpentHours]);

  useEffect(() => {
    loadPayRequests();
  }, []);

  function buildInvoicePayload() {
    const cleanedComments = Object.fromEntries(
      Object.entries(jobComments)
        .map(([id, comment]) => [id, comment.trim()])
        .filter(([, comment]) => comment.length > 0)
    );

    return {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      showSpentHours,
      jobComments: cleanedComments,
    };
  }

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
    setInvoiceConfirmOpen(false);
    toast({
      title: "Invoice sent",
      description: `Sent to ${body.sentTo}. Paid Hours: ${Number(body.hours ?? 0).toFixed(2)}, Est: ${money(body.estimatedPay)}`,
    });
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

  async function submitPayRequest() {
    if (!extraPaymentRequired) {
      toast({ title: "Turn on extra payment required first.", variant: "destructive" });
      return;
    }
    if (!payJobId) {
      toast({ title: "Select a job", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      jobId: payJobId,
      type: payType,
      cleanerNote: payNote.trim() || undefined,
    };

    if (payType === "HOURLY") {
      const hours = Number(payHours || 0);
      const rate = Number(payRate || 0);
      if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(rate) || rate <= 0) {
        toast({ title: "Enter valid hours and rate.", variant: "destructive" });
        return;
      }
      payload.requestedHours = hours;
      payload.requestedRate = rate;
    } else {
      const amount = Number(payAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "Enter a valid fixed amount.", variant: "destructive" });
        return;
      }
      payload.requestedAmount = amount;
    }

    setSavingPayRequest(true);
    const res = await fetch("/api/cleaner/pay-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingPayRequest(false);
    if (!res.ok) {
      toast({ title: "Request failed", description: body.error ?? "Could not submit request.", variant: "destructive" });
      return;
    }

    setPayNote("");
    setPayAmount("");
    setPayHours("1");
    setPayRate("");
    setExtraPaymentRequired(false);
    toast({ title: "Extra payment request submitted" });
    await loadPayRequests();
  }

  async function submitLostFound() {
    if (!jobId || !itemName.trim() || !location.trim() || !notes.trim()) {
      toast({ title: "Complete all fields", variant: "destructive" });
      return;
    }
    setSavingLostFound(true);
    const res = await fetch("/api/cleaner/lost-found", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        itemName: itemName.trim(),
        location: location.trim(),
        notes: notes.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingLostFound(false);
    if (!res.ok) {
      toast({ title: "Could not submit", description: body.error ?? "Failed.", variant: "destructive" });
      return;
    }
    setItemName("");
    setLocation("");
    setNotes("");
    toast({ title: "Lost & found reported" });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
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
                </div>

                <div className="max-h-64 space-y-2 overflow-auto">
                  {payableJobs.map((row) => (
                    <div key={row.jobId} className="rounded border p-2">
                      <p className="text-xs font-medium">{row.jobName} - {row.jobType}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {row.date} | Paid: {row.hours.toFixed(2)}h | Split: {row.split}
                        {row.rate != null ? ` | Rate: ${money(row.rate)}` : " | Rate: Not set"}
                        {showSpentHours ? ` | Spent: ${(row.spentHours ?? 0).toFixed(2)}h` : ""}
                        {` | Extra: ${money(row.approvedExtraAmount)} | Total: ${money(row.amount)}`}
                      </p>
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

          <div className="grid gap-2 sm:grid-cols-2">
            <Button onClick={downloadInvoice} disabled={invoiceDownloading} className="w-full" variant="outline">
              {invoiceDownloading ? "Generating..." : "Download Invoice PDF"}
            </Button>
            <Button onClick={() => setInvoiceConfirmOpen(true)} disabled={invoiceSending} className="w-full">
              {invoiceSending ? "Sending..." : "Email Invoice To Accounts"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Extra Payment Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2">
            <Label className="text-sm">Extra payment required</Label>
            <Switch checked={extraPaymentRequired} onCheckedChange={setExtraPaymentRequired} />
          </div>
          {!extraPaymentRequired ? (
            <p className="text-xs text-muted-foreground">Turn on extra payment required to reveal the request fields.</p>
          ) : (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Job</Label>
                <Select value={payJobId} onValueChange={setPayJobId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select job" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Request type</Label>
                <Select value={payType} onValueChange={(value) => setPayType(value as "HOURLY" | "FIXED") }>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOURLY">Hourly</SelectItem>
                    <SelectItem value="FIXED">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {payType === "HOURLY" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min="0" step="0.25" value={payHours} onChange={(e) => setPayHours(e.target.value)} placeholder="Extra hours" />
                  <Input type="number" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} placeholder="Rate" />
                </div>
              ) : (
                <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Amount" />
              )}

              <Textarea placeholder="Why extra payment is requested" value={payNote} onChange={(e) => setPayNote(e.target.value)} />

              <Button onClick={submitPayRequest} disabled={savingPayRequest || !jobs.length} className="w-full">
                {savingPayRequest ? "Submitting..." : "Submit Extra Payment Request"}
              </Button>
            </>
          )}

          <div className="rounded border p-2">
            <p className="mb-2 text-xs font-medium text-muted-foreground">My Requests</p>
            {loadingPayRequests ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : payRequests.length === 0 ? (
              <p className="text-xs text-muted-foreground">No requests yet.</p>
            ) : (
              <div className="max-h-36 space-y-2 overflow-auto">
                {payRequests.slice(0, 10).map((row: any) => (
                  <div key={row.id} className="rounded border px-2 py-1 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span>{row.job?.property?.name ?? "Job"}</span>
                      <Badge variant={row.status === "PENDING" ? ("warning" as any) : row.status === "APPROVED" ? "success" : "destructive"}>
                        {row.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">
                      Requested: {money(row.requestedAmount)}
                      {row.status === "APPROVED" ? ` | Approved: ${money(row.approvedAmount)}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Report Lost & Found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Job</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue placeholder="Select job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input placeholder="Item name" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          <Input placeholder="Where found" value={location} onChange={(e) => setLocation(e.target.value)} />
          <Textarea placeholder="Notes for admin/client" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button onClick={submitLostFound} disabled={savingLostFound || !jobs.length} className="w-full">
            {savingLostFound ? "Submitting..." : "Submit Lost & Found"}
          </Button>
        </CardContent>
      </Card>

      <TwoStepConfirmDialog
        open={invoiceConfirmOpen}
        onOpenChange={setInvoiceConfirmOpen}
        title="Email invoice to accounts?"
        description="This will email your generated invoice PDF to the accounts mailbox."
        confirmLabel="Yes, email it"
        cancelLabel="No"
        loading={invoiceSending}
        onConfirm={sendInvoice}
      />
    </div>
  );
}
