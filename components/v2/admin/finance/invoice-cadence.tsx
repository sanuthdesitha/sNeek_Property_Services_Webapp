"use client";
import { useEffect, useState } from "react";
type Client = { id: string; name: string | null; invoicingCadence: string };
export function InvoiceCadenceSettings() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; fetch("/api/admin/settings/invoice-cadence", { cache: "no-store" })
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
    .then(data => { if (active) { setClients(data.clients); setSelected(data.semimonthlyClientUserIds); setReady(true); } })
    .catch(error => { if (active) setMessage(error.message || "Unable to load cadence."); });
    return () => { active = false; };
  }, []);
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/settings/invoice-cadence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ semimonthlyClientUserIds: selected }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setMessage("Draft preparation schedule saved. No invoices were created or sent by this save.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save."); }
    finally { setBusy(false); }
  }
  return <details className="my-4 rounded-lg border p-4"><summary className="cursor-pointer font-medium">Invoice draft schedule</summary>
    <p className="my-3 text-sm">Selected client logins prepare draft invoices at 8am Sydney time on the 16th and 1st, covering the previous half-month through the full final day. Work must have started by the cutoff; offers and acceptance alone do not qualify. Unfinished work is flagged for office review and reconciliation after completion. Draft preparation does not approve cleaner pay or send, pay or export invoices. Other accounts retain their existing cadence. Requires the scheduled invoice worker.</p>
    <div className="space-y-2">{clients.map(client => <label className="flex items-center gap-2 text-sm" key={client.id}>
      <input type="checkbox" disabled={busy} checked={selected.includes(client.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, client.id] : previous.filter(id => id !== client.id))} />
      {client.name || "Unnamed client"} · {selected.includes(client.id) ? "16th + 1st, 8am Sydney (draft only)" : client.invoicingCadence}
    </label>)}</div>
    <button className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : "Save draft schedule"}</button>
    {message ? <p role="status" className="mt-2 text-sm">{message}</p> : null}
  </details>;
}
