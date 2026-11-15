"use client";

/**
 * New invoice → Blank invoice and → Credit note, as choices of the same
 * panel. Both call the existing endpoints the old dialogs called (POST
 * /api/admin/invoices { kind: "BLANK" }, POST …/[id]/credit-note with the own
 * PIN through the existing confirmation); every rule stays the server's.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type InvoiceClient, type InvoiceRow } from "../invoice-model";
import { createBlankInvoiceRequest, VOID_CREDIT_REFUSAL } from "../invoice-requests";
import { invoiceEditorPath } from "../invoice-links";
import { IssueCreditNoteDialog, useCreditableSearch } from "../create-dialogs";
import { formatMoney, periodText } from "./new-invoice-format";
import { usePeriodDefault } from "./use-new-invoice-data";

const FIELD_CLASS = cn(E_INPUT_CLASS, "max-sm:h-11 max-sm:text-[16px]");

type SaveState = { status: "idle" } | { status: "saving" } | { status: "failed"; message: string };

export function BlankInvoicePanel({ clients, canManage, initialClientId }: { clients: InvoiceClient[]; canManage: boolean; initialClientId: string }) {
  const router = useRouter();
  const [clientId, setClientId] = React.useState(initialClientId);
  const [periodStart, setPeriodStart] = React.useState("");
  const [periodEnd, setPeriodEnd] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const period = usePeriodDefault(clientId);
  const saving = save.status === "saving";

  React.useEffect(() => {
    if (period.status !== "ready" || touched || period.clientId !== clientId) return;
    setPeriodStart(period.period.start);
    setPeriodEnd(period.period.end);
  }, [period, touched, clientId]);

  const invalid = Boolean(periodStart && periodEnd && periodStart > periodEnd);

  async function create() {
    if (!clientId || !periodStart || !periodEnd || invalid) {
      setSave({ status: "failed", message: invalid ? "The period start must be on or before the period end." : "Choose a client and both period dates." });
      return;
    }
    setSave({ status: "saving" });
    try {
      const result = await createBlankInvoiceRequest({ clientId, periodStart, periodEnd });
      if (!result.ok || !result.body.id) {
        setSave({ status: "failed", message: result.body.error ?? "The invoice could not be created." });
        return;
      }
      router.push(invoiceEditorPath(result.body.id));
    } catch {
      setSave({ status: "failed", message: "Could not reach the server. Nothing was created." });
    }
  }

  return (
    <ECard className="max-w-2xl p-3.5" role="region" aria-labelledby="ni-blank-title">
      <h2 id="ni-blank-title" className="text-[0.9375rem] font-[650]">Blank invoice</h2>
      <fieldset disabled={saving} className="mt-3 space-y-3">
        <legend className="sr-only">Client and period</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="ni-blank-client" className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Client</label>
            <select id="ni-blank-client" className={FIELD_CLASS} value={clientId} onChange={(event) => { setClientId(event.target.value); setTouched(false); setPeriodStart(""); setPeriodEnd(""); setSave({ status: "idle" }); }}>
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
          <fieldset className="min-w-0 space-y-1.5">
            <legend className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Period</legend>
            <div className="grid grid-cols-2 gap-1.5">
              <label htmlFor="ni-blank-from" className="sr-only">Period start</label>
              <input id="ni-blank-from" type="date" className={FIELD_CLASS} value={periodStart} disabled={!clientId} onChange={(event) => { setTouched(true); setPeriodStart(event.target.value); }} />
              <label htmlFor="ni-blank-to" className="sr-only">Period end</label>
              <input id="ni-blank-to" type="date" className={FIELD_CLASS} value={periodEnd} disabled={!clientId} onChange={(event) => { setTouched(true); setPeriodEnd(event.target.value); }} />
            </div>
            <p className="text-[0.71875rem] text-[hsl(var(--e-muted-foreground))]">
              {invalid ? "The start must be on or before the end." : periodStart && periodEnd ? periodText(periodStart, periodEnd) : period.status === "loading" ? "Working out the usual period…" : "Choose the dates."}
            </p>
          </fieldset>
        </div>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          Creates an empty draft with the next invoice number; lines are added in the editor. It cannot be approved until it has at least one.
        </p>
        {!canManage ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Your access to invoices is view only.</p> : null}
        {save.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{save.message}</p> : null}
        <div className="flex justify-end">
          <EButton type="button" disabled={!canManage || !clientId || saving} onClick={() => void create()}>
            {saving ? "Creating…" : "Create blank invoice"}
          </EButton>
        </div>
      </fieldset>
    </ECard>
  );
}

export function CreditNotePanel({ canVoidCredit }: { canVoidCredit: boolean }) {
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<InvoiceRow | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const search = useCreditableSearch(canVoidCredit ? query : "");
  if (!canVoidCredit) {
    return (
      <ECard className="max-w-2xl p-3.5" role="region" aria-labelledby="ni-credit-title">
        <h2 id="ni-credit-title" className="text-[0.9375rem] font-[650]">Credit note</h2>
        <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{VOID_CREDIT_REFUSAL}</p>
      </ECard>
    );
  }
  return (
    <ECard className="max-w-2xl p-3.5" role="region" aria-labelledby="ni-credit-title">
      <h2 id="ni-credit-title" className="text-[0.9375rem] font-[650]">Credit note</h2>
      <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Only invoices already sent to the client are credited. An unsent invoice is edited directly.</p>
      <div className="mt-3 space-y-1.5">
        <label htmlFor="ni-credit-search" className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Find the invoice to credit</label>
        <input id="ni-credit-search" type="search" className={FIELD_CLASS} value={query} onChange={(event) => { setQuery(event.target.value); setPicked(null); }} aria-describedby="ni-credit-hint" />
        <p id="ni-credit-hint" className="text-[0.71875rem] text-[hsl(var(--e-muted-foreground))]">Invoice number, client reference or client name.</p>
      </div>
      {search.error ? <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{search.error}</p> : null}
      {search.loading ? <p role="status" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Searching…</p> : null}
      <fieldset className="mt-2 space-y-2">
        <legend className="sr-only">Invoices that can be credited</legend>
        {!search.loading && !search.error && search.rows.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No sent invoice matches.</p> : null}
        {search.rows.map((row) => (
          <label key={row.id} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5", picked?.id === row.id ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]")}>
            <input type="radio" name="ni-credit-invoice" checked={picked?.id === row.id} onChange={() => setPicked(row)} className="mt-1 h-4 w-4 accent-[hsl(var(--e-primary))]" />
            <span className="min-w-0 text-[0.8125rem]">
              <span className="block font-[600] [overflow-wrap:anywhere]">{row.invoiceNumber} · {row.client.name}</span>
              <span className="block text-[hsl(var(--e-text-secondary))]">{formatMoney(row.totalAmount)} · {STATUS_LABEL[row.status]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-3 flex justify-end">
        <EButton type="button" disabled={!picked} onClick={() => setConfirming(true)} aria-haspopup="dialog">
          Create draft credit note…
        </EButton>
      </div>
      {confirming && picked ? <IssueCreditNoteDialog invoice={picked} onClose={() => setConfirming(false)} /> : null}
    </ECard>
  );
}
