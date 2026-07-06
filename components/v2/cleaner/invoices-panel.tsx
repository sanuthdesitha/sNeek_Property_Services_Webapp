"use client";

/**
 * Estate cleaner invoices tool. Fully native Estate (only /v2 primitives + the
 * estate-kit + Estate form fields + lucide), wired to the SAME cleaner invoice
 * endpoints the live workspace (components/cleaner/invoices-page.tsx) uses:
 *   POST /api/cleaner/invoice/preview   { startDate?, endDate?, showSpentHours,
 *                                         jobComments, jobHourOverrides,
 *                                         excludedJobIds, excludedRunIds } → data
 *   POST /api/cleaner/invoice/download  { …same payload } → PDF blob
 *   POST /api/cleaner/invoice/send      { …same payload, confirmEmail: true }
 *   GET  /api/cleaner/invoice/submissions
 *   GET  /api/me/profile-completeness   → { missing: [{ key, label }] }
 */
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Mail,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { EField, EInput, ESwitch, ETextarea } from "@/components/v2/cleaner/fields";
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

interface ExpenseRow {
  runId: string;
  date: string;
  runName: string;
  properties: string;
  amount: number;
  paymentMethod: string;
  note?: string;
}

interface ShoppingTimeRow {
  runId: string;
  date: string;
  runName: string;
  properties: string;
  minutes: number;
  hourlyRate: number;
  amount: number;
  note?: string;
}

interface InvoicePreview {
  hours: number;
  estimatedPay: number;
  rows: InvoiceRow[];
  expenseRows?: ExpenseRow[];
  expenseTotal?: number;
  shoppingTimeRows?: ShoppingTimeRow[];
  shoppingTimeTotal?: number;
  extraLineRows?: Array<{ id: string; date: string; description: string; amount: number }>;
  extraLineTotal?: number;
  pendingAdjustmentCount?: number;
  pendingAdjustmentAmount?: number;
}

interface Submission {
  id: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  totalAmount: number;
  jobCount: number;
  status: string;
  createdAt: string;
}

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

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
  const start = new Date(now);
  start.setDate(start.getDate() - 13);
  return { start: isoLocal(start), end: isoLocal(now) };
}

export function InvoicesPanel() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showSpentHours, setShowSpentHours] = useState(true);
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [invoiceDownloading, setInvoiceDownloading] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<InvoicePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [jobComments, setJobComments] = useState<Record<string, string>>({});
  const [excludedJobIds, setExcludedJobIds] = useState<string[]>([]);
  const [excludedRunIds, setExcludedRunIds] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
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
    extraPayments += Number(invoicePreview?.extraLineTotal ?? 0);
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
      excludedJobIds,
      excludedRunIds,
    };
  }

  function removeJobFromInvoice(jobId: string) {
    setExcludedJobIds((prev) => (prev.includes(jobId) ? prev : [...prev, jobId]));
  }
  function removeRunFromInvoice(runId: string) {
    setExcludedRunIds((prev) => (prev.includes(runId) ? prev : [...prev, runId]));
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
    void loadInvoicePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, showSpentHours, excludedJobIds, excludedRunIds]);

  async function loadSubmissions() {
    try {
      const res = await fetch("/api/cleaner/invoice/submissions");
      if (res.ok) setSubmissions(await res.json());
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    void loadSubmissions();
  }, []);

  useEffect(
    () => () => {
      if (previewPdfUrl) window.URL.revokeObjectURL(previewPdfUrl);
    },
    [previewPdfUrl]
  );

  const pendingApprovalCount = Number(invoicePreview?.pendingAdjustmentCount ?? 0);
  const pendingApprovalAmount = Number(invoicePreview?.pendingAdjustmentAmount ?? 0);
  const hasPendingApprovals = pendingApprovalCount > 0;
  const hasPendingAwaitingApproval =
    Number(invoicePreview?.estimatedPay ?? 0) <= 0 && hasPendingApprovals;

  async function sendInvoice() {
    setInvoiceSending(true);
    const res = await fetch("/api/cleaner/invoice/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...buildInvoicePayload(), confirmEmail: true }),
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
    setExcludedJobIds([]);
    setExcludedRunIds([]);
    void loadInvoicePreview();
    void loadSubmissions();
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
        description: body.error ?? "Could not generate invoice PDF preview.",
        variant: "destructive",
      });
      return;
    }
    const blob = await res.blob();
    if (previewPdfUrl) window.URL.revokeObjectURL(previewPdfUrl);
    const url = window.URL.createObjectURL(blob);
    setPreviewPdfUrl(url);
    setEmailReviewOpen(true);
  }

  async function openEmailPreviewFlow() {
    if (hasPendingApprovals && !hasPendingAwaitingApproval) {
      const proceed = window.confirm(
        `You have ${pendingApprovalCount} extra payment${pendingApprovalCount === 1 ? "" : "s"} (${money(
          pendingApprovalAmount
        )}) still awaiting admin approval.\n\n` +
          `If you send this invoice now, those amounts will NOT be included. ` +
          `Cancel to review them under "Extra pay requests" first, or press OK to invoice without them.`
      );
      if (!proceed) return;
    }
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

  const expenseRows = invoicePreview?.expenseRows ?? [];
  const shoppingTimeRows = invoicePreview?.shoppingTimeRows ?? [];
  const removedCount = excludedJobIds.length + excludedRunIds.length;

  return (
    <div className="space-y-6">
      {missingProfileFields.length > 0 ? (
        <EAlert tone="warning" title="Complete your profile before emailing an invoice">
          <p>
            Your invoice must include these details:{" "}
            {missingProfileFields.map((f) => f.label).join(", ")}.
          </p>
          <div className="mt-3">
            <EButton asChild variant="outline" size="sm">
              <a href="/v2/cleaner/profile">Complete profile</a>
            </EButton>
          </div>
        </EAlert>
      ) : null}

      {/* Period selector */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Choose a period</ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Pick a range, review your paid hours, then download or email your invoice.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <EButton type="button" size="sm" variant="outline" onClick={() => applyPreset("thisMonth")}>
              This month
            </EButton>
            <EButton type="button" size="sm" variant="outline" onClick={() => applyPreset("lastMonth")}>
              Last month
            </EButton>
            <EButton type="button" size="sm" variant="outline" onClick={() => applyPreset("last2Weeks")}>
              Last 2 weeks
            </EButton>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Start date (optional)">
              <EInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </EField>
            <EField label="End date (optional)">
              <EInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </EField>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2">
            <label className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              <ESwitch checked={showSpentHours} onCheckedChange={setShowSpentHours} aria-label="Show hours spent" />
              Show hours spent
            </label>
            <EButton type="button" size="sm" variant="ghost" onClick={() => void loadInvoicePreview()} disabled={loadingPreview}>
              <RefreshCw className={`h-4 w-4 ${loadingPreview ? "animate-spin" : ""}`} />
              {loadingPreview ? "Refreshing…" : "Refresh preview"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      {/* Summary tiles */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard
          label="Total to invoice"
          value={loadingPreview && !invoicePreview ? "—" : money(invoicePreview?.estimatedPay)}
          delta={`${payableJobs.length} job${payableJobs.length === 1 ? "" : "s"} · ${Number(invoicePreview?.hours ?? 0).toFixed(2)}h`}
          deltaTone="neutral"
          icon={<ReceiptText className="h-4 w-4" />}
        />
        <EStatCard label="Jobs subtotal" value={money(breakdown.jobsSubtotal)} delta="base pay" deltaTone="neutral" />
        <EStatCard label="Extra payments" value={money(breakdown.extraPayments)} delta="approved extras" deltaTone="neutral" />
        <EStatCard label="Shopping time" value={money(breakdown.shoppingTime)} delta="approved" deltaTone="neutral" />
      </section>

      {breakdown.transport > 0 || Number(invoicePreview?.expenseTotal ?? 0) > 0 ? (
        <div className="flex flex-wrap gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {breakdown.transport > 0 ? <EBadge tone="neutral" soft>Transport: {money(breakdown.transport)}</EBadge> : null}
          {Number(invoicePreview?.expenseTotal ?? 0) > 0 ? (
            <EBadge tone="info" soft>Shopping reimbursements: {money(invoicePreview?.expenseTotal)} (listed below)</EBadge>
          ) : null}
        </div>
      ) : null}

      {hasPendingApprovals ? (
        <EAlert
          tone={hasPendingAwaitingApproval ? "danger" : "warning"}
          title={`${pendingApprovalCount} extra payment${pendingApprovalCount === 1 ? "" : "s"} (${money(pendingApprovalAmount)}) awaiting admin approval`}
        >
          <p>
            {hasPendingAwaitingApproval
              ? "Emailing is blocked while the total is $0.00 and these are unapproved."
              : "These are NOT on this invoice yet — sending now leaves that money off."}
          </p>
        </EAlert>
      ) : null}

      {/* Per-job list */}
      <ECard>
        <ECardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ECardTitle>Jobs in this period</ECardTitle>
            {removedCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setExcludedJobIds([]);
                  setExcludedRunIds([]);
                }}
                className="inline-flex items-center gap-1.5 text-[0.75rem] font-[550] text-[hsl(var(--e-accent-portal))] hover:underline"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore {removedCount} removed item{removedCount === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Removed items stay available for a future invoice. Once you email this invoice, its jobs are marked invoiced and won&apos;t appear again.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          {loadingPreview && !invoicePreview ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading invoice preview…</p>
          ) : !invoicePreview ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No preview available.</p>
          ) : payableJobs.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing yet"
              title="No payable jobs"
              description="No payable jobs in the selected range. Try a different period."
            />
          ) : (
            payableJobs.map((row) => {
              const overrideRaw = jobHourOverridesInput[row.jobId];
              const effectiveHours = Number(overrideRaw ?? row.hours);
              const isChanged = effectiveHours !== Number(row.originalHours);
              return (
                <div key={row.jobId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[0.875rem] font-[550]">{row.jobName}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {row.date} · {row.jobType} · Split {row.split}
                        {row.rate != null ? ` · Rate ${money(row.rate)}` : " · Rate not set"}
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="text-right">
                        <p className="e-numeral text-[0.9375rem]">{money(row.amount)}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">line total</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeJobFromInvoice(row.jobId)}
                        title="Remove this job from the invoice"
                        aria-label="Remove this job from the invoice"
                        className="rounded-[var(--e-radius-xs)] border border-[hsl(var(--e-border))] p-1 text-[hsl(var(--e-muted-foreground))] transition-colors hover:border-[hsl(var(--e-danger)/0.4)] hover:text-[hsl(var(--e-danger))]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <span>Paid: {row.hours.toFixed(2)}h</span>
                    {showSpentHours ? <span>Spent: {(row.spentHours ?? 0).toFixed(2)}h</span> : null}
                    <span>Extra: {money(row.approvedExtraAmount)}</span>
                    {row.transportAllowance > 0 ? <span>Transport: {money(row.transportAllowance)}</span> : null}
                    {row.isHoursOverridden && row.hoursChangeNote ? <span>Changed: {row.hoursChangeNote}</span> : null}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <EField label="Paid hours override">
                      <EInput
                        type="number"
                        min="0"
                        step="0.25"
                        value={jobHourOverridesInput[row.jobId] ?? ""}
                        onChange={(e) =>
                          setJobHourOverridesInput((prev) => ({ ...prev, [row.jobId]: e.target.value }))
                        }
                      />
                      {isChanged ? (
                        <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">
                          {Number(row.originalHours).toFixed(2)}h {"->"} {effectiveHours.toFixed(2)}h — tap “Refresh preview” to recalculate.
                        </p>
                      ) : null}
                    </EField>
                    <EField label="Comment (optional)">
                      <ETextarea
                        className="min-h-[40px]"
                        placeholder="Note shown on this job line in the invoice"
                        value={jobComments[row.jobId] ?? ""}
                        onChange={(e) => setJobComments((prev) => ({ ...prev, [row.jobId]: e.target.value }))}
                      />
                    </EField>
                  </div>
                </div>
              );
            })
          )}
        </ECardBody>
      </ECard>

      {/* Shopping reimbursements */}
      {expenseRows.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Shopping reimbursements · {money(invoicePreview?.expenseTotal)}</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2 pt-0">
            {expenseRows.map((row) => (
              <div key={row.runId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-success)/0.4)] bg-[hsl(var(--e-success)/0.08)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[0.875rem] font-[550]">{row.runName}</p>
                  <div className="flex items-center gap-2">
                    <span className="e-numeral text-[0.9375rem]">{money(row.amount)}</span>
                    <button
                      type="button"
                      onClick={() => removeRunFromInvoice(row.runId)}
                      title="Remove from invoice"
                      aria-label="Remove from invoice"
                      className="rounded-[var(--e-radius-xs)] border border-[hsl(var(--e-border))] p-1 text-[hsl(var(--e-muted-foreground))] transition-colors hover:border-[hsl(var(--e-danger)/0.4)] hover:text-[hsl(var(--e-danger))]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {row.date} · {row.properties} · {row.paymentMethod}
                </p>
                {row.note ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.note}</p> : null}
              </div>
            ))}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Shopping time */}
      {shoppingTimeRows.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>Shopping time · {money(invoicePreview?.shoppingTimeTotal)}</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2 pt-0">
            {shoppingTimeRows.map((row) => (
              <div key={`time-${row.runId}`} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-info)/0.3)] bg-[hsl(var(--e-info)/0.08)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[0.875rem] font-[550]">{row.runName}</p>
                  <div className="flex items-center gap-2">
                    <span className="e-numeral text-[0.9375rem]">{money(row.amount)}</span>
                    <button
                      type="button"
                      onClick={() => removeRunFromInvoice(row.runId)}
                      title="Remove from invoice"
                      aria-label="Remove from invoice"
                      className="rounded-[var(--e-radius-xs)] border border-[hsl(var(--e-border))] p-1 text-[hsl(var(--e-muted-foreground))] transition-colors hover:border-[hsl(var(--e-danger)/0.4)] hover:text-[hsl(var(--e-danger))]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {row.date} · {row.properties} · {row.minutes} min · Rate {money(row.hourlyRate)}
                </p>
                {row.note ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.note}</p> : null}
              </div>
            ))}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Actions */}
      <ECard>
        <ECardBody className="space-y-2 pt-6">
          <div className="grid gap-2 sm:grid-cols-2">
            <EButton onClick={() => void downloadInvoice()} disabled={invoiceDownloading} variant="outline" className="w-full">
              <Download className="h-4 w-4" />
              {invoiceDownloading ? "Generating…" : "Download invoice PDF"}
            </EButton>
            <EButton
              onClick={() => void openEmailPreviewFlow()}
              disabled={invoiceSending || previewingPdf || hasPendingAwaitingApproval || missingProfileFields.length > 0}
              variant="gold"
              className="w-full"
            >
              <Mail className="h-4 w-4" />
              {previewingPdf ? "Opening preview…" : invoiceSending ? "Sending…" : "Email invoice to accounts"}
            </EButton>
          </div>
          <EButton onClick={() => void loadInvoicePreview()} variant="ghost" className="w-full text-[0.75rem]">
            Refresh totals
          </EButton>
        </ECardBody>
      </ECard>

      {/* My submitted invoices */}
      {submissions.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle>My submitted invoices</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-2 pt-0">
            {submissions.map((s) => {
              const label = s.status === "PAID" ? "Paid" : s.status === "XERO_PUSHED" ? "Processing" : "Submitted";
              const tone: "success" | "info" | "warning" =
                s.status === "PAID" ? "success" : s.status === "XERO_PUSHED" ? "info" : "warning";
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                  <div className="min-w-0">
                    <p className="text-[0.875rem] font-[550]">
                      {new Date(s.periodStart).toLocaleDateString("en-AU")} – {new Date(s.periodEnd).toLocaleDateString("en-AU")}
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {s.jobCount} job{s.jobCount === 1 ? "" : "s"} · {Number(s.hours ?? 0).toFixed(1)}h · submitted{" "}
                      {new Date(s.createdAt).toLocaleDateString("en-AU")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="e-numeral text-[0.9375rem]">{money(s.totalAmount)}</span>
                    <EBadge tone={tone} soft>{label}</EBadge>
                  </div>
                </div>
              );
            })}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Email review modal */}
      <EModal open={emailReviewOpen} onClose={() => setEmailReviewOpen(false)} title="Review invoice PDF" eyebrow="Before you send" wide>
        <div className="space-y-4">
          {previewPdfUrl ? (
            <>
              <iframe
                src={previewPdfUrl}
                title="Invoice PDF preview"
                className="hidden h-[60vh] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] sm:block"
              />
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4 text-center sm:hidden">
                <p className="mb-3 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  Your invoice PDF is ready. Tap below to open it in your phone&apos;s PDF viewer.
                </p>
                <EButton asChild variant="outline" className="w-full">
                  <a href={previewPdfUrl} target="_blank" rel="noreferrer">Open PDF</a>
                </EButton>
              </div>
              <a
                href={previewPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-[0.75rem] text-[hsl(var(--e-text-faint))] underline"
              >
                Open PDF in a new tab
              </a>
            </>
          ) : (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No preview available.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <EButton variant="outline" onClick={() => setEmailReviewOpen(false)}>
              Back to edit
            </EButton>
            <EButton variant="gold" onClick={() => void sendInvoice()} disabled={invoiceSending || hasPendingAwaitingApproval}>
              {invoiceSending ? "Emailing…" : "Approve and email"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
