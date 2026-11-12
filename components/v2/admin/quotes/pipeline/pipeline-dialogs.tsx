"use client";

/**
 * Dialogs for the pipeline's row actions, each calling the endpoint the old
 * pipeline used: send a quote (recipient editable, as the old prompt was),
 * assign a quote to a client, delete a quote, counter offer to a lead.
 * Fields freeze while a request runs and keep their values when it fails.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import type { PipelineRow } from "@/lib/quotes/pipeline-types";

const INPUT = "h-10 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]";

export type PipelineDialog =
  | { kind: "send"; row: PipelineRow }
  | { kind: "assign"; row: PipelineRow }
  | { kind: "delete"; row: PipelineRow }
  | { kind: "counter"; row: PipelineRow };

type DialogProps = { dialog: PipelineDialog | null; onClose: () => void; onDone: (message: string) => Promise<void> };

async function call(url: string, method: string, body?: object): Promise<void> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? "The request was refused.");
}

function useRunner(onDone: (message: string) => Promise<void>) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (work: () => Promise<void>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request was refused.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

type ClientOption = { id: string; name: string; email?: string | null };

function AssignBody({ row, busy, value, onChange }: { row: PipelineRow; busy: boolean; value: string; onChange: (value: string) => void }) {
  const [clients, setClients] = React.useState<ClientOption[] | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/clients", { signal: controller.signal })
      .then((res) => res.json())
      .then((body: unknown) => {
        if (!controller.signal.aborted) setClients(Array.isArray(body) ? (body as ClientOption[]) : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setClients([]);
      });
    return () => controller.abort();
  }, []);
  return (
    <fieldset disabled={busy} className="space-y-2">
      <p>Addresses the quote to a client — they can view and accept it from their portal.</p>
      <label className="block text-[0.75rem] font-[550]" htmlFor="assign-client">Client</label>
      <select id="assign-client" className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} disabled={!clients}>
        <option value="">{clients ? `Unassigned${row.leadId ? " (lead)" : ""}` : "Loading clients…"}</option>
        {clients?.map((client) => (
          <option key={client.id} value={client.id}>{client.name}{client.email ? ` — ${client.email}` : ""}</option>
        ))}
      </select>
    </fieldset>
  );
}

export function PipelineDialogs({ dialog, onClose, onDone }: DialogProps) {
  const { busy, error, run, setError } = useRunner(onDone);
  const [recipient, setRecipient] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [counter, setCounter] = React.useState({ label: "", amount: "", notes: "", sendEmail: true });

  React.useEffect(() => {
    setError(null);
    if (!dialog) return;
    setRecipient(dialog.row.email ?? "");
    setClientId(dialog.row.clientId ?? "");
    const estimate = dialog.row.estimateMax ?? dialog.row.estimateMin;
    setCounter({ label: dialog.row.serviceType.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), amount: estimate != null ? String(estimate) : "", notes: "", sendEmail: true });
  }, [dialog, setError]);

  if (!dialog) return null;
  const { row } = dialog;
  const close = () => (busy ? undefined : onClose());

  const config = {
    send: {
      title: `Send quote ${row.reference}`,
      action: "Send",
      submit: () => run(() => call(`/api/admin/quotes/${row.id}/send`, "POST", recipient.trim() ? { to: recipient.trim() } : {}), `Quote sent${recipient.trim() ? ` to ${recipient.trim()}` : ""}`),
    },
    assign: {
      title: "Assign quote to client",
      action: "Save",
      submit: () => run(() => call(`/api/admin/quotes/${row.id}`, "PATCH", { clientId: clientId || null }), clientId ? "Quote assigned to client" : "Quote unassigned"),
    },
    delete: {
      title: "Delete quote",
      action: "Delete quote",
      submit: () => run(() => call(`/api/admin/quotes/${row.id}`, "DELETE"), "Quote deleted"),
    },
    counter: {
      title: `Counter offer to ${row.name}`,
      action: counter.sendEmail ? "Create and email" : "Create draft",
      submit: () => {
        const amount = Number(counter.amount);
        if (!counter.label.trim() || !Number.isFinite(amount) || amount <= 0) {
          setError("Enter a description and an amount greater than zero.");
          return Promise.resolve();
        }
        return run(
          () => call(`/api/admin/leads/${row.id}/counter-offer`, "POST", { lineItems: [{ label: counter.label.trim(), unitPrice: amount, qty: 1, total: amount }], notes: counter.notes.trim() || undefined, sendEmail: counter.sendEmail }),
          counter.sendEmail ? "Counter offer emailed" : "Counter offer saved as a draft quote",
        );
      },
    },
  }[dialog.kind];

  return (
    <EActionDialog
      open
      title={config.title}
      busy={busy}
      onClose={close}
      footer={
        <>
          <EButton size="sm" variant="ghost" disabled={busy} onClick={close}>Cancel</EButton>
          <EButton size="sm" variant={dialog.kind === "delete" ? "danger" : "primary"} disabled={busy} onClick={() => void config.submit()}>
            {busy ? "Working…" : config.action}
          </EButton>
        </>
      }
    >
      {dialog.kind === "send" ? (
        <fieldset disabled={busy} className="space-y-2">
          <label className="block text-[0.75rem] font-[550]" htmlFor="send-to">Send to email</label>
          <input id="send-to" type="email" className={INPUT} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Leave empty to use the client's or lead's email on file.</p>
        </fieldset>
      ) : null}
      {dialog.kind === "assign" ? <AssignBody row={row} busy={busy} value={clientId} onChange={setClientId} /> : null}
      {dialog.kind === "delete" ? (
        <p>This permanently removes the quote for <b>{row.name}</b>{row.total != null ? ` (${row.total.toLocaleString("en-AU", { style: "currency", currency: "AUD" })})` : ""}.</p>
      ) : null}
      {dialog.kind === "counter" ? (
        <fieldset disabled={busy} className="space-y-2">
          <p>Creates a quote for this lead with one line and marks the lead quoted.</p>
          <label className="block text-[0.75rem] font-[550]" htmlFor="counter-label">Line description</label>
          <input id="counter-label" className={INPUT} value={counter.label} onChange={(e) => setCounter((c) => ({ ...c, label: e.target.value }))} />
          <label className="block text-[0.75rem] font-[550]" htmlFor="counter-amount">Amount before GST ($)</label>
          <input id="counter-amount" className={INPUT} inputMode="decimal" value={counter.amount} onChange={(e) => setCounter((c) => ({ ...c, amount: e.target.value }))} />
          <label className="block text-[0.75rem] font-[550]" htmlFor="counter-notes">Notes, optional</label>
          <textarea id="counter-notes" className={INPUT + " h-auto py-2"} rows={2} value={counter.notes} onChange={(e) => setCounter((c) => ({ ...c, notes: e.target.value }))} />
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" checked={counter.sendEmail} onChange={(e) => setCounter((c) => ({ ...c, sendEmail: e.target.checked }))} /> Email it to {row.email ?? "the lead"} now
          </label>
        </fieldset>
      ) : null}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}
