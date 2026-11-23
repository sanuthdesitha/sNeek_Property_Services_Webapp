"use client";

/**
 * Settings › Money › Xero › Cleaner bills (2026-11-23): the Xero expense
 * accounts cleaner and QA inspector invoices are pushed to as bills. Read and
 * saved through GET/PATCH /api/admin/integrations/settings (only these three
 * fields are sent, so the invoice defaults are untouched). With no cleaning
 * work account the bill push is refused; nothing is defaulted.
 *
 * The codebase reads one account's name from Xero but does not load the chart
 * of accounts, so these are validated code fields rather than a picker.
 */
import { useEffect, useState } from "react";
import { EAlert, EButton, ECard } from "@/components/v2/ui/primitives";
import { EField, EInput } from "./estate-form";
import { isValidXeroAccountCode } from "@/lib/xero/cleaner-bill-accounts";

type CleanerBillAccounts = {
  cleanerBillAccountCode: string;
  cleanerBillInspectionAccountCode: string;
  cleanerBillReimbursementAccountCode: string;
};

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };
type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

const EMPTY: CleanerBillAccounts = { cleanerBillAccountCode: "", cleanerBillInspectionAccountCode: "", cleanerBillReimbursementAccountCode: "" };

const FIELDS: Array<{ key: keyof CleanerBillAccounts; id: string; label: string; hint: string; placeholder: string }> = [
  { key: "cleanerBillAccountCode", id: "xero-cleaner-bill", label: "Cleaning work account (required)", hint: "Job pay, extras and shopping time. Without it, pushing a cleaner invoice to Xero is refused.", placeholder: "e.g. 477" },
  { key: "cleanerBillInspectionAccountCode", id: "xero-cleaner-bill-qa", label: "QA inspections account", hint: "Inspection lines and inspector travel. Leave empty to use the cleaning work account.", placeholder: "same as cleaning work" },
  { key: "cleanerBillReimbursementAccountCode", id: "xero-cleaner-bill-reimburse", label: "Reimbursements account", hint: "Shopping the payee paid for, parking and receipts. Leave empty to use the cleaning work account.", placeholder: "same as cleaning work" },
];

function readAccounts(body: unknown): CleanerBillAccounts {
  const xero = (body as { xero?: Record<string, unknown> } | null)?.xero ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    cleanerBillAccountCode: text(xero.cleanerBillAccountCode),
    cleanerBillInspectionAccountCode: text(xero.cleanerBillInspectionAccountCode),
    cleanerBillReimbursementAccountCode: text(xero.cleanerBillReimbursementAccountCode),
  };
}

export function CleanerBillAccountsCard() {
  const [values, setValues] = useState<CleanerBillAccounts>(EMPTY);
  const [saved, setSaved] = useState<CleanerBillAccounts>(EMPTY);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const saving = save.status === "saving";

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/integrations/settings", { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setLoad({ status: "error", message: (body as { error?: string } | null)?.error ?? "The stored accounts could not be read." });
          return;
        }
        const accounts = readAccounts(body);
        setValues(accounts);
        setSaved(accounts);
        setLoad({ status: "ready" });
      } catch {
        if (!controller.signal.aborted) setLoad({ status: "error", message: "The stored accounts could not be read. Reload to try again." });
      }
    })();
    return () => controller.abort();
  }, []);

  const invalid = FIELDS.filter((field) => !isValidXeroAccountCode(values[field.key].trim()));
  const changed = FIELDS.some((field) => values[field.key].trim() !== saved[field.key]);

  async function submit() {
    if (invalid.length || saving) return;
    setSave({ status: "saving" });
    const body = Object.fromEntries(FIELDS.map((field) => [field.key, values[field.key].trim()])) as CleanerBillAccounts;
    try {
      const response = await fetch("/api/admin/integrations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xero: body }),
      });
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setSave({ status: "error", message: (answer as { error?: string } | null)?.error ?? "The accounts were not saved." });
        return;
      }
      const stored = readAccounts(answer);
      setSaved(stored);
      setValues(stored);
      setSave({ status: "saved" });
    } catch {
      setSave({ status: "error", message: "No answer from the server. They may not have been saved; reload to see what is stored." });
    }
  }

  return (
    <ECard className="p-6">
      <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">Cleaner bills</h3>
      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        The Xero expense accounts cleaner and QA inspector invoices go to when pushed as bills. Use account codes from your Xero chart of accounts.
      </p>
      {load.status === "loading" ? <p className="mt-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Reading the stored accounts…</p> : null}
      {load.status === "error" ? (
        <EAlert tone="danger" title="Could not read the cleaner bill accounts" className="mt-4">
          <p>{load.message} Nothing can be saved here until they are read, so a stored account is never overwritten by a blank.</p>
        </EAlert>
      ) : null}
      {load.status === "ready" ? (
        <>
          {!saved.cleanerBillAccountCode ? (
            <EAlert tone="warning" title="No account chosen for cleaner invoices" className="mt-4">
              <p>Pushing a cleaner invoice to Xero is refused until the cleaning work account is set.</p>
            </EAlert>
          ) : null}
          <fieldset disabled={saving} className="mt-5 grid gap-5 sm:grid-cols-3">
            {FIELDS.map((field) => (
              <EField key={field.key} label={field.label} htmlFor={field.id} hint={!isValidXeroAccountCode(values[field.key].trim()) ? "Up to 10 letters, digits, dot, dash or underscore." : field.hint}>
                <EInput
                  id={field.id}
                  value={values[field.key]}
                  maxLength={10}
                  aria-invalid={!isValidXeroAccountCode(values[field.key].trim()) || undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValues((previous) => ({ ...previous, [field.key]: value }));
                    if (save.status !== "saving") setSave({ status: "idle" });
                  }}
                  placeholder={field.placeholder}
                  className="max-sm:text-[16px]"
                />
              </EField>
            ))}
          </fieldset>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {save.status === "saved" ? <span role="status" className="text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))]">Cleaner bill accounts saved</span> : null}
            {save.status === "error" ? <span role="alert" className="text-[0.8125rem] font-medium text-[hsl(var(--e-danger))]">{save.message}</span> : null}
            <EButton onClick={submit} disabled={saving || invalid.length > 0 || !changed}>
              {saving ? "Saving…" : "Save cleaner bill accounts"}
            </EButton>
          </div>
        </>
      ) : null}
    </ECard>
  );
}
