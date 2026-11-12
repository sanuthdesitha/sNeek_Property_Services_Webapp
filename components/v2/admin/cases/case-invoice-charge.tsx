"use client";

/**
 * Cases → Next steps → "Add charge to invoice" (Wave F). Lists the charges
 * already added from this case ("Charge on INV-0412 (draft)", linked) and
 * opens a dialog to add one: description, amount before GST, and the client's
 * draft invoice (or a new draft). Only for people who may edit invoices; the
 * server re-checks, and refuses anything but a draft of the case's client.
 * Keyed by case id by its parent, so a draft never follows another case.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import type { CaseChargeContext, CaseChargeResult } from "@/lib/billing/client-invoice-case-charge";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: CaseChargeContext };

const money = (value: number) => `$${value.toFixed(2)}`;
const STATUS_WORD: Record<string, string> = { DRAFT: "draft", APPROVED: "approved", SENT: "sent", PAID: "paid", PART_PAID: "part paid", OVERDUE: "overdue", VOID: "void" };

export function CaseInvoiceCharge({ caseId, caseTitle }: { caseId: string; caseTitle: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [revision, setRevision] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [invoiceId, setInvoiceId] = React.useState("new");
  const [description, setDescription] = React.useState(caseTitle);
  const [amount, setAmount] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<CaseChargeResult | null>(null);
  const requestKey = React.useRef<{ key: string; id: string } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/cases/${encodeURIComponent(caseId)}/invoice-charge`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (CaseChargeContext & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.charges) throw new Error(body?.error ?? "Could not load invoices for this case.");
        setLoad({ status: "ready", value: body });
        setInvoiceId((current) => (current === "new" && body.drafts[0] ? body.drafts[0].id : current));
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: failure instanceof Error ? failure.message : "Could not load invoices for this case." });
      });
    return () => controller.abort();
  }, [caseId, revision]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    const draft = load.status === "ready" ? load.value.drafts.find((row) => row.id === invoiceId) : undefined;
    const body = { invoiceId: invoiceId === "new" ? null : invoiceId, description: description.trim(), amount: Math.round(value * 100) / 100, ...(draft ? { expectedUpdatedAt: draft.updatedAt } : {}) };
    const key = JSON.stringify(body);
    if (requestKey.current?.key !== key) requestKey.current = { key, id: crypto.randomUUID() };
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/cases/${encodeURIComponent(caseId)}/invoice-charge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestKey: requestKey.current.id }) });
      const result = (await response.json().catch(() => null)) as (CaseChargeResult & { error?: string }) | null;
      if (!response.ok || !result?.invoiceId) throw new Error(result?.error ?? `Not added (${response.status}).`);
      requestKey.current = null;
      setAdded(result);
      setAmount("");
      setRevision((count) => count + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Not added.");
    } finally {
      setSaving(false);
    }
  }

  const context = load.status === "ready" ? load.value : null;
  const amountValue = Number(amount);
  const valid = description.trim().length > 0 && amount.trim() !== "" && Number.isFinite(amountValue) && amountValue >= 0.01;
  return (
    <div className="flex flex-col items-start gap-1">
      {context?.charges.length ? (
        <ul aria-label="Charges from this case" className="space-y-0.5 text-[0.75rem]">
          {context.charges.map((charge) => (
            <li key={charge.lineId}>
              Charge on <Link className="font-[600] text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/finance/invoices/${encodeURIComponent(charge.invoiceId)}`}>{charge.invoiceNumber}</Link> ({STATUS_WORD[charge.status] ?? charge.status.toLowerCase()}) · {money(charge.lineTotal)}
            </li>
          ))}
        </ul>
      ) : null}
      {load.status === "error" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {context && !context.clientId ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Link the case to a client, property or job to add a charge.</p> : null}
      <EButton size="sm" variant="outline" disabled={!context?.canManage || !context.clientId} title={context && !context.canManage ? "Your access to invoices does not allow editing." : undefined} onClick={() => { setOpen(true); setAdded(null); setError(null); }}>
        Add charge to invoice
      </EButton>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Adds a line to a draft invoice of {context?.clientName ?? "the client"}; nothing is approved or sent.</p>
      <EModal open={open} onClose={() => (saving ? undefined : setOpen(false))} eyebrow={caseTitle} title="Add charge to invoice">
        {added ? (
          <div className="space-y-3 text-[0.875rem]">
            <p>Added to <Link className="font-[600] text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/finance/invoices/${encodeURIComponent(added.invoiceId)}`}>{added.invoiceNumber}</Link>{added.createdDraft ? " (a new draft)" : ""}. It is still a draft: review and send it from the invoice.</p>
            <div className="flex justify-end border-t border-[hsl(var(--e-border))] pt-4"><EButton size="sm" onClick={() => setOpen(false)}>Close</EButton></div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={saving} className="space-y-3">
              <EField label="Invoice">
                <ESelect value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
                  {(context?.drafts ?? []).map((draft) => <option key={draft.id} value={draft.id}>{draft.invoiceNumber} · draft · {money(draft.totalAmount)}</option>)}
                  <option value="new">New draft invoice</option>
                </ESelect>
              </EField>
              <EField label="Description"><EInput required maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} /></EField>
              <EField label="Amount before GST" hint="GST is added as the invoice's GST setting says.">
                <EInput required type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </EField>
              {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
              <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                <EButton type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</EButton>
                <EButton type="submit" size="sm" disabled={!valid}>{saving ? "Adding…" : "Add charge"}</EButton>
              </div>
            </fieldset>
          </form>
        )}
      </EModal>
    </div>
  );
}
