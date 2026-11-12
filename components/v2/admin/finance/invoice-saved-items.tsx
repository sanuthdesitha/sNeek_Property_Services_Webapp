"use client";

/**
 * "Saved invoice items" under Billing schedule (Wave D): the list the invoice
 * editor's add-line box offers (name, default rate, GST flag). One save
 * replaces the list, guarded by the version read, audited on the server. The
 * GST flag is a note for the editor: each invoice's GST switch decides.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import type { SavedInvoiceItem, SavedItemsPayload } from "@/lib/billing/invoice-saved-items";
import { getSavedItems, putSavedItems } from "./invoices/invoice-requests";

type Row = { id: string; name: string; rate: string; gst: boolean };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

function newId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toRows(items: SavedInvoiceItem[]): Row[] {
  return items.map((item) => ({ id: item.id, name: item.name, rate: item.rate.toFixed(2), gst: item.gst }));
}

/** The items to save, or the first problem. */
export function validateSavedItemRows(rows: Row[]): { ok: true; items: SavedInvoiceItem[] } | { ok: false; message: string } {
  const items: SavedInvoiceItem[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const rate = Number(row.rate);
    if (!name) return { ok: false, message: "Every item needs a name." };
    if (!row.rate.trim() || !Number.isFinite(rate) || rate < 0) return { ok: false, message: `Give "${name}" a rate of zero or more.` };
    items.push({ id: row.id, name, rate: Math.round(rate * 100) / 100, gst: row.gst });
  }
  return { ok: true, items };
}

export function InvoiceSavedItems() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [rows, setRows] = useState<Row[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const result = await getSavedItems<SavedItemsPayload>(controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok || !Array.isArray(result.body.items)) {
          setLoad({ status: "error", message: result.body.error ?? "Saved items could not be loaded." });
          return;
        }
        setRows(toRows(result.body.items));
        setVersion(result.body.updatedAt);
        setLoad({ status: "ready" });
      } catch {
        if (!controller.signal.aborted) setLoad({ status: "error", message: "Saved items could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, []);

  function update(id: string, patch: Partial<Row>) {
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function save() {
    const checked = validateSavedItemRows(rows);
    if (!checked.ok) {
      setMessage({ tone: "bad", text: checked.message });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await putSavedItems<SavedItemsPayload>({ items: checked.items, expectedUpdatedAt: version });
      if (!result.ok) {
        setMessage({ tone: "bad", text: result.body.error ?? "The items could not be saved. Your edits are still here." });
        return;
      }
      setRows(toRows(result.body.items));
      setVersion(result.body.updatedAt);
      setMessage({ tone: "ok", text: "Saved items updated." });
    } catch {
      setMessage({ tone: "bad", text: "No answer from the server. Your edits are still here; save again." });
    } finally {
      setBusy(false);
    }
  }

  if (load.status === "loading") return <p role="status" className="text-[0.8125rem]">Loading saved items…</p>;
  if (load.status === "error") return <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p>;
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        Charges you add to invoices often. Typing in an invoice&rsquo;s add-line box offers them with their rate. GST is still set per
        invoice: the flag only shows a note when it differs from the invoice&rsquo;s GST switch.
      </p>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="sr-only">Saved invoice items</legend>
        {rows.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No saved items yet.</p> : null}
        {rows.map((row, index) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
            <EInput aria-label={`Item ${index + 1} name`} className="min-w-0 flex-1 basis-[12rem]" maxLength={200} value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} />
            <EInput aria-label={`Item ${index + 1} rate`} className="w-[7rem] text-right" inputMode="decimal" value={row.rate} onChange={(event) => update(row.id, { rate: event.target.value })} />
            <label className="inline-flex min-h-11 items-center gap-2 text-[0.8125rem] sm:min-h-9">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--e-primary))]" checked={row.gst} onChange={(event) => update(row.id, { gst: event.target.checked })} />
              GST
            </label>
            <EButton type="button" size="sm" variant="ghost" onClick={() => setRows((previous) => previous.filter((item) => item.id !== row.id))}>
              Remove
            </EButton>
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={() => setRows((previous) => [...previous, { id: newId(), name: "", rate: "", gst: true }])}>
          Add item
        </EButton>
        <EButton type="button" size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save items"}
        </EButton>
      </div>
      {message ? (
        <p role={message.tone === "bad" ? "alert" : "status"} className={message.tone === "bad" ? "text-[0.8125rem] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-text-secondary))]"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
