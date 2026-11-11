"use client";

/**
 * Record payment, one-click Mark as paid and the payment record viewer, moved
 * from estate-invoices.tsx with their request bodies and wording unchanged.
 * The amount owing comes from the server row (lib/finance/receivables).
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EInput, EModal, ESelect, ETableShell, ETextarea } from "@/components/v2/admin/estate-kit";
import {
  PAY_METHODS,
  PAY_METHOD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  fmtDate,
  money,
  type FullInvoice,
  type InvoiceRow,
} from "./invoice-model";
import { getInvoice, patchInvoice } from "./invoice-requests";

type DialogProps = { invoice: InvoiceRow; onClose: () => void; onDone: () => void };

function Figure({ label, value, gold = false }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <EEyebrow>{label}</EEyebrow>
      <p className={"e-numeral mt-1 text-[1rem] leading-none" + (gold ? " text-[hsl(var(--e-gold-ink))]" : "")}>{value}</p>
    </div>
  );
}

export function RecordPaymentDialog({ invoice, onClose, onDone }: DialogProps) {
  const [amount, setAmount] = useState(invoice.amountOwing.toFixed(2));
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [paidDate, setPaidDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const value = Number(amount);
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await patchInvoice<{ status?: string }>(invoice.id, {
        recordPayment: {
          amount: value,
          method,
          paidDate: paidDate ? `${paidDate}T00:00:00.000Z` : undefined,
          reference: reference.trim() || undefined,
        },
      });
      if (!result.ok) {
        toast({ title: "Could not record payment", description: result.body.error, variant: "destructive" });
        return;
      }
      toast({
        title: result.body.status === "PAID" ? "Payment recorded — invoice paid" : "Partial payment recorded",
        description: `${money(value)} · ${PAY_METHOD_LABEL[method] ?? method}`,
      });
      onDone();
      onClose();
    } catch {
      toast({ title: "Could not reach the server", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <EModal open onClose={() => !saving && onClose()} eyebrow="Commercial" title={`Record payment · ${invoice.invoiceNumber}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 sm:grid-cols-3">
          <Figure label="Invoice total" value={money(invoice.totalAmount)} />
          <Figure label="Already paid" value={money(invoice.paidAmount ?? 0)} />
          <Figure label="Outstanding" value={money(invoice.amountOwing)} gold />
        </div>
        <fieldset disabled={saving} className="space-y-4">
          <EField
            label="Amount received"
            hint="Defaults to the outstanding balance. A smaller amount records a partial payment (status stays Part paid)."
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                $
              </span>
              <EInput
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                aria-label="Amount received"
                className="pl-6"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </EField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EField label="Payment method">
              <ESelect aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAY_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Paid date">
              <EInput type="date" aria-label="Paid date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </EField>
          </div>
          <EField label="Reference / notes" hint="e.g. bank reference, receipt number, part-payment note.">
            <ETextarea rows={2} aria-label="Reference / notes" value={reference} onChange={(e) => setReference(e.target.value)} />
          </EField>
        </fieldset>
        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </EButton>
          <EButton variant="gold" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            Record payment
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

export function MarkPaidDialog({ invoice, onClose, onDone }: DialogProps) {
  const [saving, setSaving] = useState(false);
  const outstanding = invoice.amountOwing;

  async function confirm() {
    setSaving(true);
    try {
      // Settle the outstanding balance via the payment-recording procedure —
      // the PATCH route flips the status to PAID once fully settled and appends
      // to the metadata.payments[] ledger. If nothing is outstanding (edge:
      // already fully paid but status never flipped), fall back to the legacy
      // direct status flip.
      const payload =
        outstanding > 0
          ? { recordPayment: { amount: outstanding, method: "MANUAL", reference: "Marked as paid" } }
          : { status: "PAID" };
      const result = await patchInvoice(invoice.id, payload);
      if (!result.ok) {
        toast({ title: "Could not mark as paid", description: result.body.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Invoice marked as paid",
        description: outstanding > 0 ? `${money(outstanding)} recorded as received.` : undefined,
      });
      onDone();
      onClose();
    } catch {
      toast({ title: "Could not reach the server", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <EConfirmModal
      open
      onClose={() => !saving && onClose()}
      title={`Mark ${invoice.invoiceNumber} as paid?`}
      description={
        outstanding > 0 ? (
          <>
            Records the outstanding{" "}
            <span className="e-tnum font-[550] text-[hsl(var(--e-foreground))]">{money(outstanding)}</span> as received and
            marks the invoice paid. Use Record payment instead for a partial amount or to note the method and reference.
          </>
        ) : (
          "Nothing is outstanding on this invoice — it will simply be marked as paid."
        )
      }
      confirmLabel="Mark as paid"
      danger={false}
      loading={saving}
      onConfirm={confirm}
    />
  );
}

type ReceiptState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; invoice: FullInvoice };

export function ReceiptDialog({ invoice, onClose }: Omit<DialogProps, "onDone">) {
  const [state, setState] = useState<ReceiptState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getInvoice<FullInvoice>(invoice.id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) setState({ status: "error", message: result.body.error ?? "The payment record could not be loaded." });
        else setState({ status: "ready", invoice: result.body });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error", message: "The payment record could not be loaded." });
      });
    return () => controller.abort();
  }, [invoice.id]);

  return (
    <EModal open onClose={onClose} eyebrow="Commercial" title={`Payment record · ${invoice.invoiceNumber}`} wide>
      {state.status === "loading" ? (
        <p role="status" className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading payment record…
        </p>
      ) : state.status === "error" ? (
        <p role="alert" className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-danger))]">
          {state.message}
        </p>
      ) : (
        <ReceiptBody receipt={state.invoice} />
      )}
    </EModal>
  );
}

function ReceiptBody({ receipt }: { receipt: FullInvoice }) {
  const payments = Array.from(receipt.metadata?.payments ?? []);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <EEyebrow>Status</EEyebrow>
          <div className="mt-1">
            <EBadge tone={STATUS_TONE[receipt.status]} soft>
              {STATUS_LABEL[receipt.status]}
            </EBadge>
          </div>
        </div>
        <Figure label="Invoice total" value={money(receipt.totalAmount)} />
        <Figure label="Amount paid" value={money(receipt.paidAmount ?? 0)} />
        <Figure label="Outstanding" value={money(Math.max(0, Number(receipt.totalAmount ?? 0) - Number(receipt.paidAmount ?? 0)))} />
      </div>
      <div className="space-y-2">
        <EEyebrow>Payment history</EEyebrow>
        {payments.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {receipt.paidAt
              ? `Marked paid on ${fmtDate(receipt.paidAt)}${
                  receipt.paymentMethod ? ` · ${PAY_METHOD_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod}` : ""
                } — no itemised payment record (legacy one-click paid).`
              : "No payment record captured yet."}
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Paid date" },
              { label: "Method" },
              { label: "Reference" },
              { label: "Recorded by" },
              { label: "Amount", align: "right" },
            ]}
          >
            {payments.map((p, i) => (
              <tr key={i} className="border-t border-[hsl(var(--e-border))]">
                <td className="px-4 py-2 text-[0.8125rem]">{fmtDate(p.paidDate)}</td>
                <td className="px-4 py-2 text-[0.8125rem]">{PAY_METHOD_LABEL[p.method] ?? p.method}</td>
                <td className="px-4 py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{p.reference || "—"}</td>
                <td className="px-4 py-2 text-[0.8125rem]">
                  {p.recordedByName || "—"}
                  <span className="block text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{fmtDate(p.recordedAt)}</span>
                </td>
                <td className="px-4 py-2 text-right text-[0.8125rem] e-tnum">{money(p.amount)}</td>
              </tr>
            ))}
          </ETableShell>
        )}
      </div>
    </div>
  );
}
