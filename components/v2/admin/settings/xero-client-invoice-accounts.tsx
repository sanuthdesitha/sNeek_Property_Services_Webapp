"use client";

/**
 * Settings › Money › Xero › Client invoices (2026-11-23): the Xero accounts
 * client invoices and credit notes are pushed to. Read and saved through
 * GET/PATCH /api/admin/integrations/settings (only these fields are sent, so
 * the invoice defaults and cleaner bill accounts are untouched). With no sales
 * account, pushes, credit notes, Update in Xero and CSV exports are refused;
 * nothing is defaulted.
 *
 * Existing installs carry a stored sales account of "200" that every save used
 * to write back whether or not anyone chose it. It keeps working and is shown
 * as "currently used: 200 — confirm or change" until saved here.
 *
 * The codebase reads one account's name from Xero but does not load the chart
 * of accounts, so these are validated code fields rather than a picker.
 */
import { useEffect, useState } from "react";
import { EAlert, EButton, ECard } from "@/components/v2/ui/primitives";
import { EField, EInput } from "./estate-form";
import { isValidXeroAccountCode } from "@/lib/xero/cleaner-bill-accounts";
import { salesAccountNeedsConfirmation } from "@/lib/xero/client-invoice-accounts";

type ClientInvoiceAccountFields = {
  defaultAccountCode: string;
  clientRepairsAccountCode: string;
  clientShoppingAccountCode: string;
  clientCreditNoteAccountCode: string;
  disbursementAccountCode: string;
};

type StoredClientInvoiceAccounts = ClientInvoiceAccountFields & { defaultAccountCodeConfirmed: boolean };

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };
type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

type FieldSpec = { key: keyof ClientInvoiceAccountFields; id: string; label: string; hint: string; placeholder: string };

const EMPTY: StoredClientInvoiceAccounts = {
  defaultAccountCode: "",
  clientRepairsAccountCode: "",
  clientShoppingAccountCode: "",
  clientCreditNoteAccountCode: "",
  disbursementAccountCode: "",
  defaultAccountCodeConfirmed: false,
};

const FIELDS: FieldSpec[] = [
  {
    key: "defaultAccountCode",
    id: "xero-client-sales",
    label: "Sales account (required)",
    hint: "Cleaning services, extras on job lines, other charges and discounts. Without it, pushing a client invoice to Xero is refused.",
    placeholder: "Xero account code",
  },
  {
    key: "clientRepairsAccountCode",
    id: "xero-client-repairs",
    label: "Repairs account",
    hint: "Repairs the client agreed to cover. Leave empty to use the sales account.",
    placeholder: "same as sales",
  },
  {
    key: "clientShoppingAccountCode",
    id: "xero-client-shopping",
    label: "Shopping recharges account",
    hint: "Shopping purchases recharged to the client and shopping time. Leave empty to use the sales account.",
    placeholder: "same as sales",
  },
  {
    key: "clientCreditNoteAccountCode",
    id: "xero-client-credit-notes",
    label: "Credit notes account",
    hint: "Every credit note line except agency disbursements. Leave empty to credit each line to the account its kind uses.",
    placeholder: "same as each line",
  },
  {
    key: "disbursementAccountCode",
    id: "xero-disbursement",
    label: "Agency disbursements account",
    hint: "Balance-sheet clearing account for client agency purchases, BAS Excluded. Must differ from sales; invoices with agency purchases are refused without it.",
    placeholder: "e.g. 820",
  },
];

function readAccounts(body: unknown): StoredClientInvoiceAccounts {
  const xero = (body as { xero?: Record<string, unknown> } | null)?.xero ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    defaultAccountCode: text(xero.defaultAccountCode),
    clientRepairsAccountCode: text(xero.clientRepairsAccountCode),
    clientShoppingAccountCode: text(xero.clientShoppingAccountCode),
    clientCreditNoteAccountCode: text(xero.clientCreditNoteAccountCode),
    disbursementAccountCode: text(xero.disbursementAccountCode),
    defaultAccountCodeConfirmed: xero.defaultAccountCodeConfirmed === true,
  };
}

function fieldValues(stored: StoredClientInvoiceAccounts): ClientInvoiceAccountFields {
  const { defaultAccountCodeConfirmed: _confirmed, ...fields } = stored;
  return fields;
}

/** The notice above the fields: nothing stored, the old "200" to confirm, or nothing. */
function SalesAccountNotice({ saved }: { saved: StoredClientInvoiceAccounts }) {
  if (!saved.defaultAccountCode) {
    return (
      <EAlert tone="warning" title="No sales account chosen for client invoices" className="mt-4">
        <p>Pushing a client invoice or credit note to Xero, Update in Xero and the Xero CSV exports are refused until the sales account is set.</p>
      </EAlert>
    );
  }
  if (salesAccountNeedsConfirmation(saved)) {
    return (
      <EAlert tone="warning" title={`Currently used: ${saved.defaultAccountCode} — confirm or change`} className="mt-4">
        <p>
          This account was stored before accounts had to be chosen, so it may never have been picked on purpose. Pushes keep using it. Check it is your sales
          account in Xero, then save to confirm it, or enter the right one.
        </p>
      </EAlert>
    );
  }
  return null;
}

export function ClientInvoiceAccountsCard() {
  const [values, setValues] = useState<ClientInvoiceAccountFields>(fieldValues(EMPTY));
  const [saved, setSaved] = useState<StoredClientInvoiceAccounts>(EMPTY);
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
        setValues(fieldValues(accounts));
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
  const sales = values.defaultAccountCode.trim();
  const confirming = !changed && salesAccountNeedsConfirmation(saved);
  const disbursementClash = Boolean(sales) && values.disbursementAccountCode.trim() === sales;

  async function submit() {
    if (invalid.length || saving || disbursementClash) return;
    setSave({ status: "saving" });
    const fields = Object.fromEntries(FIELDS.map((field) => [field.key, values[field.key].trim()])) as ClientInvoiceAccountFields;
    // Saving here is the owner's choice of the sales account (confirms an old stored one).
    const body = fields.defaultAccountCode ? { ...fields, defaultAccountCodeConfirmed: true as const } : fields;
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
      setValues(fieldValues(stored));
      setSave({ status: "saved" });
    } catch {
      setSave({ status: "error", message: "No answer from the server. They may not have been saved; reload to see what is stored." });
    }
  }

  return (
    <ECard className="p-6">
      <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">Client invoices</h3>
      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        The Xero accounts client invoices and credit notes go to when pushed, updated or exported. Use account codes from your Xero chart of accounts.
      </p>
      {load.status === "loading" ? <p className="mt-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Reading the stored accounts…</p> : null}
      {load.status === "error" ? (
        <EAlert tone="danger" title="Could not read the client invoice accounts" className="mt-4">
          <p>{load.message} Nothing can be saved here until they are read, so a stored account is never overwritten by a blank.</p>
        </EAlert>
      ) : null}
      {load.status === "ready" ? (
        <>
          <SalesAccountNotice saved={saved} />
          <fieldset disabled={saving} className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((field) => {
              const fieldInvalid = !isValidXeroAccountCode(values[field.key].trim());
              const clash = field.key === "disbursementAccountCode" && disbursementClash;
              return (
                <EField
                  key={field.key}
                  label={field.label}
                  htmlFor={field.id}
                  hint={fieldInvalid ? "Up to 10 letters, digits, dot, dash or underscore." : clash ? "Must differ from the sales account." : field.hint}
                >
                  <EInput
                    id={field.id}
                    value={values[field.key]}
                    maxLength={10}
                    aria-invalid={fieldInvalid || clash || undefined}
                    onChange={(event) => {
                      const value = event.target.value;
                      setValues((previous) => ({ ...previous, [field.key]: value }));
                      if (save.status !== "saving") setSave({ status: "idle" });
                    }}
                    placeholder={field.placeholder}
                    className="max-sm:text-[16px]"
                  />
                </EField>
              );
            })}
          </fieldset>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {save.status === "saved" ? <span role="status" className="text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))]">Client invoice accounts saved</span> : null}
            {save.status === "error" ? <span role="alert" className="text-[0.8125rem] font-medium text-[hsl(var(--e-danger))]">{save.message}</span> : null}
            <EButton onClick={submit} disabled={saving || invalid.length > 0 || disbursementClash || (!changed && !confirming)}>
              {saving ? "Saving…" : confirming ? `Confirm ${saved.defaultAccountCode} as the sales account` : "Save client invoice accounts"}
            </EButton>
          </div>
        </>
      ) : null}
    </ECard>
  );
}
