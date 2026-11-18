"use client";

import { useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ETextarea,
  ESaveStatus,
  ESectionHeading,
  EToggle,
  useSaveStatus,
} from "./estate-form";

/**
 * Bank & payment details — the `invoicing.*` bank fields plus `accountsEmail`,
 * saved via the same partial PATCH /api/admin/settings the v1 editor uses.
 * Keys mirror settings-editor.tsx exactly (invoicing.bankName / bankBsb /
 * bankAccountNumber / bankAccountName / paymentNote / abn / companyAddress /
 * defaultPaymentTermsDays; top-level accountsEmail).
 */
export type BankSettings = {
  accountsEmail: string;
  defaultPaymentTermsDays: number;
  abn: string;
  bankName: string;
  bankBsb: string;
  bankAccountNumber: string;
  bankAccountName: string;
  companyAddress: string;
  paymentNote: string;
  /** invoicing.payRequestsBillClientByDefault (2026-11-18). */
  payRequestsBillClientByDefault: boolean;
};

export function BankSection({ initial, readOnly }: { initial: BankSettings; readOnly: boolean }) {
  const [form, setForm] = useState<BankSettings>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function set<K extends keyof BankSettings>(key: K, value: BankSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountsEmail: form.accountsEmail,
          invoicing: {
            defaultPaymentTermsDays: form.defaultPaymentTermsDays,
            abn: form.abn,
            bankName: form.bankName,
            bankBsb: form.bankBsb,
            bankAccountNumber: form.bankAccountNumber,
            bankAccountName: form.bankAccountName,
            companyAddress: form.companyAddress,
            paymentNote: form.paymentNote,
            payRequestsBillClientByDefault: form.payRequestsBillClientByDefault,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Invoicing"
        title="Bank & payment details"
        description="Shown on client invoice PDFs and email attachments."
      />

      <ECard className="p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <EField label="Accounts email" htmlFor="bank-accounts-email" hint="Reply-to and CC for invoice emails.">
            <EInput
              id="bank-accounts-email"
              type="email"
              value={form.accountsEmail}
              onChange={(e) => set("accountsEmail", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="Default payment terms (days)" htmlFor="bank-terms">
            <EInput
              id="bank-terms"
              type="number"
              min={0}
              max={90}
              value={form.defaultPaymentTermsDays}
              onChange={(e) => set("defaultPaymentTermsDays", Number(e.target.value || 14))}
              disabled={readOnly}
            />
          </EField>
          <EField label="ABN" htmlFor="bank-abn">
            <EInput id="bank-abn" value={form.abn} onChange={(e) => set("abn", e.target.value)} disabled={readOnly} />
          </EField>
          <EField label="Account name" htmlFor="bank-acct-name">
            <EInput
              id="bank-acct-name"
              value={form.bankAccountName}
              onChange={(e) => set("bankAccountName", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="Bank name" htmlFor="bank-name">
            <EInput
              id="bank-name"
              value={form.bankName}
              onChange={(e) => set("bankName", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="BSB" htmlFor="bank-bsb">
            <EInput
              id="bank-bsb"
              value={form.bankBsb}
              onChange={(e) => set("bankBsb", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="Account number" htmlFor="bank-acct-number">
            <EInput
              id="bank-acct-number"
              value={form.bankAccountNumber}
              onChange={(e) => set("bankAccountNumber", e.target.value)}
              disabled={readOnly}
            />
          </EField>
        </div>
      </ECard>

      <ECard className="p-6">
        <div className="grid gap-5">
          <EField label="Company address" htmlFor="bank-address">
            <ETextarea
              id="bank-address"
              rows={2}
              value={form.companyAddress}
              onChange={(e) => set("companyAddress", e.target.value)}
              disabled={readOnly}
            />
          </EField>
          <EField label="Payment note" htmlFor="bank-note" hint="e.g. Please include the invoice number as payment reference.">
            <ETextarea
              id="bank-note"
              rows={2}
              value={form.paymentNote}
              onChange={(e) => set("paymentNote", e.target.value)}
              disabled={readOnly}
            />
          </EField>
        </div>
      </ECard>

      {/* Pay requests on client invoices (owner default pending confirmation,
          2026-11-18): decides only what the approval dialog starts from. */}
      <ECard className="p-6">
        <EToggle
          checked={form.payRequestsBillClientByDefault}
          onChange={(v) => set("payRequestsBillClientByDefault", v)}
          disabled={readOnly}
          label="Bill approved pay requests to the client by default"
          description="For a pay request linked to a job and recorded as work, approving it adds the client amount to that job's line on the client's draft invoice. Parking, reimbursements and requests without a job are never billed by default. The approval dialog says what will be added, and can switch it off for one request."
        />
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Read-only — administrator access required to edit.</p>
        )}
      </div>
    </div>
  );
}
