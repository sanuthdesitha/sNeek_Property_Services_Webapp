"use client";

/**
 * Creating documents by hand (Money step (c)):
 *   - Issue credit note: confirm, create a DRAFT credit note against a sent
 *     invoice, then open it in the editor to reduce it to a partial credit.
 *   - Credit note from "New invoice": pick the sent invoice to credit first.
 *   - Blank invoice: choose the client and period, then open the empty draft.
 * Every rule (which invoices can be credited, the limit, numbering) is the
 * server's; these dialogs only collect the choice and show its answer.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import type { ClientInvoiceListPayload } from "@/lib/billing/client-invoice-list-types";
import { STATUS_LABEL, money, type InvoiceClient, type InvoiceRow } from "./invoice-model";
import { createBlankInvoiceRequest, createCreditNoteRequest } from "./invoice-requests";
import { invoiceEditorPath } from "./invoice-links";

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
      {message}
    </p>
  );
}

/** Confirm and create a credit note for one invoice, then open it. */
export function IssueCreditNoteDialog({ invoice, onClose }: { invoice: Pick<InvoiceRow, "id" | "invoiceNumber" | "totalAmount">; onClose: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const result = await createCreditNoteRequest(invoice.id);
      if (!result.ok || !result.body.id) {
        setError(result.body.error ?? "The credit note could not be created.");
        return;
      }
      router.push(invoiceEditorPath(result.body.id));
      onClose();
    } catch {
      setError("Could not reach the server. Nothing was created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EConfirmModal
      open
      onClose={() => !saving && onClose()}
      title={`Issue a credit note for ${invoice.invoiceNumber}?`}
      confirmLabel="Create draft credit note"
      danger={false}
      loading={saving}
      onConfirm={confirm}
      description={
        <div className="space-y-2">
          <p>
            A draft credit note is created with every line of {invoice.invoiceNumber} ({money(invoice.totalAmount)}) as a
            credit. Reduce or remove lines for a partial credit, then approve and send it. {invoice.invoiceNumber} itself is
            not changed.
          </p>
          <ErrorLine message={error} />
        </div>
      }
    />
  );
}

const CREDITABLE = new Set(["SENT", "PART_PAID", "PAID"]);

function useCreditableSearch(query: string) {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ paginated: "1", status: "active", pageSize: "25", sort: "created", dir: "desc" });
    if (query.trim()) params.set("q", query.trim());
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/invoices?${params.toString()}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json().then((body: ClientInvoiceListPayload & { error?: string }) => ({ ok: response.ok, body })))
        .then(({ ok, body }) => {
          // Checked after parsing: a late answer for an older query is dropped.
          if (controller.signal.aborted) return;
          if (!ok) {
            setError(body.error ?? "Invoices could not be loaded.");
            setRows([]);
            return;
          }
          setError(null);
          setRows(body.rows.filter((row) => row.kind !== "CREDIT_NOTE" && CREDITABLE.has(row.status) && !row.fullyCredited));
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("Invoices could not be loaded.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return { rows, loading, error };
}

/** "New invoice → Credit note": choose the sent invoice to credit. */
export function NewCreditNoteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<InvoiceRow | null>(null);
  const { rows, loading, error } = useCreditableSearch(query);

  if (picked) return <IssueCreditNoteDialog invoice={picked} onClose={onClose} />;
  return (
    <EModal open onClose={onClose} eyebrow="New invoice" title="Credit note: choose the invoice to credit">
      <div className="space-y-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          Only invoices already sent to the client are credited. An unsent invoice is edited directly.
        </p>
        <EField label="Find an invoice" hint="Invoice number, client reference or client name.">
          <EInput aria-label="Find an invoice" value={query} onChange={(event) => setQuery(event.target.value)} />
        </EField>
        <ErrorLine message={error} />
        <ul aria-label="Invoices that can be credited" aria-busy={loading} className="max-h-[18rem] divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          {!loading && !error && rows.length === 0 ? (
            <li className="px-3 py-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No sent invoice matches.</li>
          ) : null}
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]"
                onClick={() => setPicked(row)}
              >
                <span className="min-w-0">
                  <span className="font-mono">{row.invoiceNumber}</span> · <span className="break-words">{row.client.name}</span>
                </span>
                <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">
                  {money(row.totalAmount)} · {STATUS_LABEL[row.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <EButton type="button" variant="ghost" onClick={onClose}>
            Cancel
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

/** "New invoice → Blank invoice": a client and a period, then the editor. */
export function BlankInvoiceDialog({ clients, onClose }: { clients: InvoiceClient[]; onClose: () => void }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!clientId || !periodStart || !periodEnd) {
      setError("Choose a client and both period dates.");
      return;
    }
    if (periodStart > periodEnd) {
      setError("The period start must be on or before the period end.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createBlankInvoiceRequest({ clientId, periodStart, periodEnd });
      if (!result.ok || !result.body.id) {
        setError(result.body.error ?? "The invoice could not be created.");
        return;
      }
      router.push(invoiceEditorPath(result.body.id));
      onClose();
    } catch {
      setError("Could not reach the server. Nothing was created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EModal open onClose={() => !saving && onClose()} eyebrow="New invoice" title="Blank invoice">
      <fieldset disabled={saving} className="space-y-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          Creates an empty draft with the next invoice number. Add its lines in the editor; it cannot be approved until it
          has at least one.
        </p>
        <EField label="Client">
          <ESelect aria-label="Client" value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Choose a client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </ESelect>
        </EField>
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Period start">
            <EInput type="date" aria-label="Period start" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </EField>
          <EField label="Period end">
            <EInput type="date" aria-label="Period end" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </EField>
        </div>
        <ErrorLine message={error} />
        <div className="flex justify-end gap-2">
          <EButton type="button" variant="ghost" onClick={onClose}>
            Cancel
          </EButton>
          <EButton type="button" onClick={() => void create()}>
            Create blank invoice
          </EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
