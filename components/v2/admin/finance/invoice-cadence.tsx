"use client";
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
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
  // Restyled with Estate primitives; it now sits behind "Billing schedule" on
  // Invoices and pay, which supplies the heading.
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Selected client logins prepare draft invoices at 8am Sydney time on the 16th and 1st, covering the previous half-month through the full final day. Work must have started by the cutoff; offers and acceptance alone do not qualify. Unfinished work is flagged for office review and reconciliation after completion. Draft preparation does not approve cleaner pay or send, pay or export invoices. Other accounts retain their existing cadence. Requires the scheduled invoice worker.</p>
      <fieldset disabled={busy} className="max-h-[50vh] space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
        <legend className="sr-only">Clients on the 16th and 1st schedule</legend>
        {clients.map(client => (
          <label className="flex min-h-[2.75rem] items-center gap-2.5 rounded-[var(--e-radius-sm)] px-2 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]" key={client.id}>
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--e-primary))]" checked={selected.includes(client.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, client.id] : previous.filter(id => id !== client.id))} />
            <span className="min-w-0 flex-1">
              <span className="font-[550] text-[hsl(var(--e-foreground))]">{client.name || "Unnamed client"}</span>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{selected.includes(client.id) ? "16th + 1st, 8am Sydney (draft only)" : client.invoicingCadence}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <EButton size="sm" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : "Save draft schedule"}</EButton>
      {message ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{message}</p> : null}
    </div>
  );
}
