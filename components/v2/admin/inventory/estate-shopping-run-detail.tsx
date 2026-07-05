"use client";

/**
 * ESTATE shopping-run detail — v2-native run desk (PO, receipts, client
 * reimbursement, cleaner reimbursement, shopping-time approval). Same endpoints:
 *   GET   /api/admin/inventory/shopping-runs/[id]                      → ShoppingRunAdminView
 *   PATCH /api/admin/inventory/shopping-runs/[id]                      { status?, payment?, clientChargeStatus?, cleanerReimbursementStatus?, shoppingTime? }
 *   GET   /api/admin/inventory/shopping-runs/[id]/po?supplier=&orderReference=   → PDF (direct download)
 *   GET   /api/admin/inventory/shopping-runs/[id]/reimbursement?clientId=        → PDF (direct download)
 *   POST  /api/admin/inventory/shopping-runs/[id]/deposit-on-hand                → moves purchased stock to on-hand
 *   POST  /api/uploads/direct                                          (receipt upload → { key, url })
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileText, Loader2, Receipt, ShoppingCart, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EEyebrow, EStatCard } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETableShell } from "@/components/v2/admin/estate-kit";

type Attachment = { key: string; url: string; name: string; mimeType?: string; sizeBytes?: number };
type Payment = {
  method: string;
  paidByScope: string;
  paidByUserId?: string | null;
  paidByName?: string | null;
  note?: string;
  receipts: Attachment[];
};
type Allocation = {
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  propertyNames: string[];
  lineCount: number;
  actualAmount: number;
  estimatedAmount: number;
  receiptCount: number;
  requiresClientCharge: boolean;
};
type RunDetail = {
  id: string;
  name: string;
  status: "DRAFT" | "IN_PROGRESS" | "COMPLETED";
  ownerScope: "CLIENT" | "CLEANER";
  ownerName?: string;
  ownerEmail?: string;
  paidByDisplay?: string;
  payment: Payment;
  clientChargeStatus: "NOT_REQUIRED" | "READY" | "SENT" | "PAID";
  cleanerReimbursementStatus: "NOT_APPLICABLE" | "READY" | "INVOICED" | "REIMBURSED";
  reimbursementNote?: string;
  totals: {
    includedLineCount: number;
    purchasedLineCount: number;
    estimatedTotalCost: number;
    actualTotalCost: number;
    reimbursableClientAmount: number;
    reimbursableCleanerAmount: number;
  };
  clientAllocations: Allocation[];
};

const PAYMENT_METHODS = [
  "COMPANY_CARD",
  "CLIENT_CARD",
  "CLEANER_PERSONAL_CARD",
  "ADMIN_PERSONAL_CARD",
  "CASH",
  "BANK_TRANSFER",
  "OTHER",
];
const CLIENT_CHARGE = ["NOT_REQUIRED", "READY", "SENT", "PAID"] as const;
const CLEANER_REIMB = ["NOT_APPLICABLE", "READY", "INVOICED", "REIMBURSED"] as const;
const RUN_STATUS = ["DRAFT", "IN_PROGRESS", "COMPLETED"] as const;

const money = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n ?? 0));
const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function EstateShoppingRunDetail({
  initialRun,
  runId,
}: {
  initialRun: RunDetail;
  runId: string;
}) {
  const [run, setRun] = useState<RunDetail>(initialRun);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [poSupplier, setPoSupplier] = useState("");
  const [poRef, setPoRef] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const receipts = run.payment?.receipts ?? [];
  const primaryClientId = useMemo(
    () => run.clientAllocations.find((a) => a.clientId)?.clientId ?? null,
    [run.clientAllocations],
  );

  async function patch(body: Record<string, unknown>, msg: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/inventory/shopping-runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Update failed", description: data.error, variant: "destructive" });
        return false;
      }
      // The PATCH endpoint returns the admin *record* (payment, totals, statuses)
      // but not the detail-only fields (clientAllocations / paidByDisplay), so we
      // merge over prev and keep those unless the response actually carries them.
      setRun((prev) => ({
        ...prev,
        ...(data as Partial<RunDetail>),
        clientAllocations: (data as Partial<RunDetail>).clientAllocations ?? prev.clientAllocations,
        paidByDisplay: (data as Partial<RunDetail>).paidByDisplay ?? prev.paidByDisplay,
      }));
      toast({ title: msg });
      return true;
    } finally {
      setSaving(false);
    }
  }

  function updatePayment(next: Partial<Payment>, msg: string) {
    const payment = { ...run.payment, ...next };
    return patch({ payment }, msg);
  }

  async function uploadReceipts(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "shopping-receipts");
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.key) throw new Error(body.error ?? `Could not upload ${file.name}.`);
        uploaded.push({
          key: body.key,
          url: body.url,
          name: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size || undefined,
        });
      }
      await updatePayment({ receipts: [...receipts, ...uploaded] }, "Receipts uploaded");
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function depositOnHand() {
    setDepositing(true);
    try {
      const res = await fetch(`/api/admin/inventory/shopping-runs/${runId}/deposit-on-hand`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not deposit", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Purchased stock deposited to on-hand" });
    } finally {
      setDepositing(false);
    }
  }

  const poHref = () => {
    const q = new URLSearchParams();
    if (poSupplier.trim()) q.set("supplier", poSupplier.trim());
    if (poRef.trim()) q.set("orderReference", poRef.trim());
    const qs = q.toString();
    return `/api/admin/inventory/shopping-runs/${runId}/po${qs ? `?${qs}` : ""}`;
  };
  const reimbursementHref = (clientId: string | null) =>
    `/api/admin/inventory/shopping-runs/${runId}/reimbursement${clientId ? `?clientId=${clientId}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/v2/admin/inventory?tab=shopping-runs"
            className="inline-flex items-center gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-gold-ink))]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Shopping runs
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-[hsl(var(--e-gold-ink))]" />
            <h1 className="e-display-sm">{run.name}</h1>
            <EBadge tone={run.status === "COMPLETED" ? "success" : run.status === "IN_PROGRESS" ? "info" : "neutral"} soft>
              {label(run.status)}
            </EBadge>
          </div>
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {run.ownerName ?? "—"} · {run.ownerScope.toLowerCase()} · paid by {run.paidByDisplay ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ESelect
            className="h-9 w-40"
            value={run.status}
            disabled={saving}
            onChange={(e) => patch({ status: e.target.value }, "Run status updated")}
          >
            {RUN_STATUS.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </ESelect>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Included lines" value={run.totals.includedLineCount} />
        <EStatCard label="Purchased lines" value={run.totals.purchasedLineCount} />
        <EStatCard label="Estimated" value={money(run.totals.estimatedTotalCost)} />
        <EStatCard label="Actual" value={money(run.totals.actualTotalCost)} />
      </section>

      {/* Purchase order */}
      <ECard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          <h2 className="text-[0.9375rem] font-[600] text-[hsl(var(--e-foreground))]">Purchase order</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <EField label="Supplier (optional)">
            <EInput value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)} placeholder="All suppliers" />
          </EField>
          <EField label="Order reference (optional)">
            <EInput value={poRef} onChange={(e) => setPoRef(e.target.value)} />
          </EField>
          <EButton variant="gold" asChild>
            <a href={poHref()} target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5" /> Download PO PDF
            </a>
          </EButton>
        </div>
      </ECard>

      {/* Payment & receipts */}
      <ECard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          <h2 className="text-[0.9375rem] font-[600] text-[hsl(var(--e-foreground))]">Payment &amp; receipts</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Payment method">
            <ESelect
              value={run.payment?.method ?? "COMPANY_CARD"}
              disabled={saving}
              onChange={(e) => updatePayment({ method: e.target.value }, "Payment updated")}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Paid by (name)">
            <EInput
              defaultValue={run.payment?.paidByName ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (run.payment?.paidByName ?? "")) updatePayment({ paidByName: v || null }, "Payment updated");
              }}
            />
          </EField>
          <EField label="Payment note" className="sm:col-span-2">
            <EInput
              defaultValue={run.payment?.note ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (run.payment?.note ?? "")) updatePayment({ note: v || undefined }, "Payment updated");
              }}
            />
          </EField>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <EButton variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Uploading…" : "Upload receipts"}
          </EButton>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              void uploadReceipts(e.target.files);
              e.currentTarget.value = "";
            }}
          />
          <EButton variant="ghost" size="sm" disabled={depositing} onClick={depositOnHand}>
            {depositing ? "Depositing…" : "Deposit purchased → on-hand"}
          </EButton>
        </div>

        {receipts.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {receipts.map((r) => (
              <li
                key={r.key}
                className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]"
              >
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[hsl(var(--e-gold-ink))] hover:underline"
                >
                  {r.name}
                </a>
                <EButton
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  className="text-[hsl(var(--e-danger))]"
                  onClick={() => updatePayment({ receipts: receipts.filter((x) => x.key !== r.key) }, "Receipt removed")}
                >
                  Remove
                </EButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-text-faint))]">No receipts uploaded yet.</p>
        )}
      </ECard>

      {/* Reimbursement & charges */}
      <ECard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <EEyebrow>Reimbursement &amp; charges</EEyebrow>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Client charge status" hint={`Reimbursable: ${money(run.totals.reimbursableClientAmount)}`}>
            <ESelect
              value={run.clientChargeStatus}
              disabled={saving}
              onChange={(e) => patch({ clientChargeStatus: e.target.value }, "Client charge updated")}
            >
              {CLIENT_CHARGE.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField
            label="Cleaner reimbursement status"
            hint={`Reimbursable: ${money(run.totals.reimbursableCleanerAmount)}`}
          >
            <ESelect
              value={run.cleanerReimbursementStatus}
              disabled={saving}
              onChange={(e) => patch({ cleanerReimbursementStatus: e.target.value }, "Cleaner reimbursement updated")}
            >
              {CLEANER_REIMB.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </ESelect>
          </EField>
        </div>

        {run.clientAllocations.length > 0 ? (
          <div className="mt-4">
            <ETableShell
              headers={[
                { label: "Client" },
                { label: "Properties" },
                { label: "Lines", align: "center" },
                { label: "Actual", align: "right" },
                { label: "", align: "right" },
              ]}
            >
              {run.clientAllocations.map((a, i) => (
                <tr key={a.clientId ?? i}>
                  <td className="px-4 py-2.5">
                    <span className="font-[550] text-[hsl(var(--e-foreground))]">{a.clientName}</span>
                    {a.clientEmail ? (
                      <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{a.clientEmail}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {a.propertyNames.join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                    {a.lineCount}
                  </td>
                  <td className="px-4 py-2.5 text-right e-numeral text-[hsl(var(--e-foreground))]">
                    {money(a.actualAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <EButton variant="outline" size="sm" asChild>
                      <a href={reimbursementHref(a.clientId)} target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" /> Reimbursement PDF
                      </a>
                    </EButton>
                  </td>
                </tr>
              ))}
            </ETableShell>
          </div>
        ) : (
          <div className="mt-4">
            <EButton variant="outline" size="sm" asChild>
              <a href={reimbursementHref(primaryClientId)} target="_blank" rel="noopener noreferrer">
                <Download className="h-3.5 w-3.5" /> Download reimbursement PDF
              </a>
            </EButton>
          </div>
        )}
      </ECard>
    </div>
  );
}
