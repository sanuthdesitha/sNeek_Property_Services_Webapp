"use client";

/**
 * The dialogs a cleaner-invoice action opens: record payment, request changes,
 * reverse / delete / reject-claim confirmations and delivery review. Moved out
 * of the old workspace; same endpoints, same rules, same wording. Each keeps
 * its draft while open and shows the server's refusal verbatim.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Loader2, MessageSquareWarning } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { CLEANER_PAY_METHODS, CLEANER_PAY_METHOD_LABEL, bankFromLineData, fmtDay, money, type CleanerRow } from "./cleaner-invoice-model";

export type CleanerDialog =
  | null
  | { kind: "record-payment" | "request-changes" | "reverse" | "delete" | "reject-claim" | "review-delivery"; row: CleanerRow };

type Send = { url: string; method: "PATCH" | "POST" | "DELETE"; body?: unknown };

async function send({ url, method, body }: Send): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    return response.ok ? { ok: true } : { ok: false, error: json.error ?? `Request failed (${response.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

function useRun(onDone: () => void, onClose: () => void) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function run(request: Send, success: { title: string; description?: string }, failure: string) {
    setBusy(true);
    const result = await send(request);
    setBusy(false);
    if (!result.ok) {
      toast({ title: failure, description: result.error, variant: "destructive" });
      return;
    }
    toast(success);
    onClose();
    onDone();
  }
  return { busy, run };
}

function PaymentDialog({ row, onClose, onDone }: { row: CleanerRow; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(Number(row.totalAmount ?? 0).toFixed(2));
  const [bank, setBank] = useState(bankFromLineData(row.lineData));
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const { busy, run } = useRun(onDone, onClose);

  function submit() {
    const value = Number(amount);
    if (amount.trim() && (Number.isNaN(value) || value < 0)) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    const paid = amount.trim() ? value : Number(row.totalAmount ?? 0);
    void run(
      {
        url: `/api/admin/cleaner-invoices/${row.id}`,
        method: "PATCH",
        body: {
          status: "PAID",
          paidAmount: amount.trim() ? value : undefined,
          paidBankAccount: bank.trim() || undefined,
          paidNote: note.trim() || undefined,
          paymentMethod: method,
          paidDate: date ? `${date}T00:00:00.000Z` : undefined,
        },
      },
      { title: "Marked paid", description: `${money(paid)} · ${CLEANER_PAY_METHOD_LABEL[method] ?? method}${bank.trim() ? ` → ${bank.trim()}` : ""}` },
      "Could not mark paid",
    );
  }

  return (
    <EModal open onClose={() => !busy && onClose()} size="md" eyebrow={row.cleanerName} title="Record payment">
      <div className="space-y-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Invoice total {money(row.totalAmount)} · {fmtDay(row.periodStart)} – {fmtDay(row.periodEnd)}</p>
        <EField label="Amount paid" hint="Defaults to the invoice total — edit if you paid a different amount.">
          <EInput type="number" inputMode="decimal" step="0.01" min="0" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} />
        </EField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EField label="Payment method">
            <ESelect value={method} disabled={busy} onChange={(event) => setMethod(event.target.value)}>
              {CLEANER_PAY_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </ESelect>
          </EField>
          <EField label="Paid date">
            <EInput type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
          </EField>
        </div>
        <EField label="Bank account paid to" hint="Which account the money was sent to (prefilled from the cleaner's details when available).">
          <EInput value={bank} disabled={busy} onChange={(event) => setBank(event.target.value)} placeholder="e.g. Jane Doe · BSB 062-000 · Acc 1234 5678" />
        </EField>
        <EField label="Comments (optional)">
          <ETextarea rows={3} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Reference, part-payment note, etc." />
        </EField>
        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton variant="gold" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Mark paid
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

function ChangesDialog({ row, onClose, onDone }: { row: CleanerRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const { busy, run } = useRun(onDone, onClose);
  return (
    <EModal open onClose={() => !busy && onClose()} size="md" eyebrow={row.cleanerName} title="Send this invoice back">
      <div className="space-y-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {row.invoiceNumber ? `${row.invoiceNumber} · ` : ""}{money(row.totalAmount)} · {fmtDay(row.periodStart)} – {fmtDay(row.periodEnd)}
        </p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          The payee is emailed your note, and every job, adjustment, inspection and expense on this invoice is released so they can correct it and resend.
        </p>
        <EField label="What needs changing" hint="Required. Name the line or the amount — the payee cannot guess which of them is wrong.">
          <ETextarea rows={4} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="e.g. The 14 Aug clean at Bondi is billed at 4h — the job record shows 2.5h." />
        </EField>
        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="ghost" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton
            variant="gold"
            disabled={busy || note.trim().length === 0}
            onClick={() =>
              void run(
                { url: `/api/admin/cleaner-invoices/${row.id}`, method: "PATCH", body: { status: "CHANGES_REQUESTED", changesNote: note.trim() } },
                { title: "Sent back to the payee", description: `${row.cleanerName} has been emailed, and everything on this invoice is billable again.` },
                "Could not request changes",
              )
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareWarning className="h-4 w-4" />} Request changes
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

function DeliveryDialog({ row, onClose, onDone }: { row: CleanerRow; onClose: () => void; onDone: () => void }) {
  const [evidence, setEvidence] = useState("");
  const { busy, run } = useRun(onDone, onClose);
  const resolve = (resolution: "CONFIRMED_SENT" | "CONFIRMED_NOT_SENT") =>
    void run(
      { url: `/api/admin/cleaner-invoices/${row.id}/delivery-review`, method: "POST", body: { resolution, evidenceNote: evidence.trim() } },
      { title: "Delivery review recorded", description: "No email was sent or retried." },
      "Review not saved",
    );
  const blocked = busy || evidence.trim().length < 10;
  return (
    <EModal open onClose={() => !busy && onClose()} title="Review invoice delivery" size="md">
      <div className="space-y-4">
        <p className="text-sm">Check accounts&apos; received email and provider delivery evidence for this exact invoice. Its money is reserved. If delivery is uncertain, close this dialog and keep it reserved. Neither action sends an email.</p>
        <EField label="Evidence checked and conclusion (required)">
          <ETextarea value={evidence} disabled={busy} onChange={(event) => setEvidence(event.target.value)} placeholder="Reference the received invoice or provider evidence confirming it was not delivered." />
        </EField>
        <div className="flex flex-wrap gap-2">
          <EButton disabled={blocked} onClick={() => resolve("CONFIRMED_SENT")}>Confirmed received — keep invoice</EButton>
          <EButton variant="outline" disabled={blocked} onClick={() => resolve("CONFIRMED_NOT_SENT")}>Confirmed not delivered — void and release</EButton>
        </div>
      </div>
    </EModal>
  );
}

function ConfirmDialog({ dialog, onClose, onDone }: { dialog: Exclude<CleanerDialog, null>; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useRun(onDone, onClose);
  const { row } = dialog;
  const copy = {
    reverse: {
      title: "Reverse this invoice?",
      description: `Mark ${row.cleanerName}'s invoice (${money(row.totalAmount)}) as reversed. The cleaner can then resend a corrected invoice.`,
      confirm: "Reverse invoice",
      request: { url: `/api/admin/cleaner-invoices/${row.id}`, method: "PATCH", body: { status: "VOID" } } as Send,
      success: "Invoice reversed — the cleaner can resend.",
    },
    delete: {
      title: "Delete this invoice?",
      description: `Permanently delete ${row.cleanerName}'s invoice (${money(row.totalAmount)}). The cleaner can resend a corrected one.`,
      confirm: "Delete invoice",
      request: { url: `/api/admin/cleaner-invoices/${row.id}`, method: "DELETE" } as Send,
      success: "Invoice deleted — the cleaner can resend a corrected one.",
    },
    "reject-claim": {
      title: "Reject this payment claim?",
      description: `${row.cleanerName} says this invoice has been paid. Rejecting returns it to ${row.xeroBillId ? "In Xero" : "Submitted (it will need approving again)"} and keeps the claim on record.`,
      confirm: "Reject claim",
      request: { url: `/api/admin/cleaner-invoices/${row.id}`, method: "PATCH", body: { status: "SUBMITTED" } } as Send,
      success: "Claim rejected.",
    },
  }[dialog.kind as "reverse" | "delete" | "reject-claim"];
  return (
    <EConfirmModal
      open
      onClose={() => !busy && onClose()}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirm}
      loading={busy}
      onConfirm={() => run(copy.request, { title: copy.success }, "Action failed")}
    />
  );
}

export function CleanerInvoiceDialogs({ dialog, onClose, onDone }: { dialog: CleanerDialog; onClose: () => void; onDone: () => void }) {
  // A different invoice or action starts from a clean form.
  const [key, setKey] = useState(0);
  useEffect(() => setKey((value) => value + 1), [dialog]);
  if (!dialog) return null;
  const props = { row: dialog.row, onClose, onDone };
  switch (dialog.kind) {
    case "record-payment":
      return <PaymentDialog key={key} {...props} />;
    case "request-changes":
      return <ChangesDialog key={key} {...props} />;
    case "review-delivery":
      return <DeliveryDialog key={key} {...props} />;
    default:
      return <ConfirmDialog key={key} dialog={dialog} onClose={onClose} onDone={onDone} />;
  }
}
