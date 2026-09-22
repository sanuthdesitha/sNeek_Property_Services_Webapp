"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";
import type { StockItem } from "./own-stock-entry";
const quantity = z.number().finite().positive().max(1_000_000);
const batchSchema = z.discriminatedUnion("action", [
  z.object({ requestId: z.string().uuid(), action: z.literal("RECORD"), entries: z.array(z.object({ itemId: z.string().min(1), quantity, sourceNote: z.string().max(2000).optional() }).strict()).min(1).max(50) }).strict(),
  z.object({ requestId: z.string().uuid(), action: z.literal("DELIVER"), propertyId: z.string().min(1), entries: z.array(z.object({ heldStockId: z.string().min(1), quantity }).strict()).min(1).max(50) }).strict(),
]);
type Batch = z.infer<typeof batchSchema>;
type Holding = { id: string; quantity: number; sourceNote?: string | null; item: StockItem | null };
type Props = { scope: string; action: Batch["action"]; items: StockItem[]; holdings: Holding[]; properties: { id: string; name: string; suburb: string }[]; onSaved: () => Promise<void> };
export function StockBatchForm({ scope, action, items, holdings, properties, onSaved }: Props) {
  const [rows, setRows] = useState([{ itemId: "", quantity: "", sourceNote: "" }]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [propertyId, setPropertyId] = useState("");
  const [pending, setPending] = useState<Batch | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false), mounted = useRef(true);
  const storageKey = `cleaner-stock-batch:${scope}:${action}`;
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) { const saved = batchSchema.parse(JSON.parse(raw)); if (saved.action !== action) throw new Error("Scope mismatch"); setPending(saved);
        if (saved.action === "RECORD") setRows(saved.entries.map(row => ({ itemId: row.itemId, quantity: String(row.quantity), sourceNote: row.sourceNote ?? "" })));
        else { setPropertyId(saved.propertyId); setSelected(Object.fromEntries(saved.entries.map(row => [row.heldStockId, String(row.quantity)]))); }
      }
      setReady(true);
    } catch { setMessage("Pending stock could not be restored. Keep this browser data and ask the office to check before recording again."); }
    return () => { mounted.current = false; };
  }, [storageKey, action]);
  const locked = busy || !!pending || !ready;
  async function submit() {
    if (lock.current || !ready) return;
    let batch = pending;
    if (!batch) {
      const requestId = crypto.randomUUID();
      const candidate = action === "RECORD" ? { requestId, action, entries: rows.map(row => ({ itemId: row.itemId, quantity: row.quantity.trim() ? Number(row.quantity) : 0, sourceNote: row.sourceNote.trim() })) } : { requestId, action, propertyId, entries: Object.entries(selected).map(([heldStockId, value]) => ({ heldStockId, quantity: value.trim() ? Number(value) : 0 })) };
      const parsed = batchSchema.safeParse(candidate);
      if (!parsed.success) { setMessage("Choose between 1 and 50 items and enter valid positive quantities. Delivery also needs a property."); return; }
      batch = parsed.data;
      const ids = batch.entries.map(row => "itemId" in row ? row.itemId : row.heldStockId);
      if (new Set(ids).size !== ids.length) { setMessage("Choose each item only once in this batch."); return; }
      if (batch.action === "RECORD" && batch.entries.some(row => !items.some(item => item.id === row.itemId))) { setMessage("Choose current catalogue items."); return; }
      if (batch.action === "DELIVER" && (!properties.some(property => property.id === (batch as Extract<Batch, { action: "DELIVER" }>).propertyId) || batch.entries.some(row => !holdings.some(held => held.id === row.heldStockId && held.quantity >= row.quantity)))) { setMessage("Check the property and available quantities before delivery."); return; }
    }
    try { sessionStorage.setItem(storageKey, JSON.stringify(batch)); } catch { setMessage("Browser storage is unavailable. Nothing was sent. Enable storage and try again."); return; }
    lock.current = true; setBusy(true); setPending(batch); setMessage("");
    try {
      const response = await fetch("/api/cleaner/inventory/held-stock/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if ([400, 403, 404, 409, 422].includes(response.status)) { sessionStorage.removeItem(storageKey); if (mounted.current) setPending(null); }
        throw new Error(typeof body?.error === "string" ? body.error : "Batch was not confirmed. Retry this same batch.");
      }
      if (!body || body.ok !== true || typeof body.batchId !== "string" || !/^held_batch_[a-f0-9]{64}$/.test(body.batchId) || !Array.isArray(body.results) || body.results.length !== batch.entries.length || body.results.some((row: any) => !row || typeof row.id !== "string" || !row.id || (batch.action === "DELIVER" && (!batch.entries.some(entry => entry.heldStockId === row.id) || typeof row.deliveryId !== "string" || !row.deliveryId))) || new Set(body.results.map((row: any) => row.id)).size !== body.results.length) throw new Error("Batch acknowledgement was not valid. Retry this same batch.");
      sessionStorage.removeItem(storageKey);
      if (!mounted.current) return;
      setPending(null); setRows([{ itemId: "", quantity: "", sourceNote: "" }]); setSelected({}); setPropertyId("");
      setMessage(typeof body.notificationWarning === "string" ? `Batch saved. ${body.notificationWarning}` : action === "RECORD" ? "All items recorded as held by you." : "All selected stock delivered. Property counts updated.");
      if (typeof body.notificationWarning === "string") toast({ title: "Batch saved", description: body.notificationWarning });
      await onSaved();
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Batch was not confirmed. Retry this same batch."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const deliveryRows = [...holdings.filter(held => held.quantity > 0), ...Object.keys(selected).filter(id => !holdings.some(held => held.id === id && held.quantity > 0)).map(id => ({ id, quantity: Number(selected[id]), item: null }))];
  return <form className="space-y-3 rounded-lg border p-4 min-w-0" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-semibold">{action === "RECORD" ? "Record multiple stock items" : "Deliver multiple stock items"}</h3>
    <p className="text-sm">{action === "RECORD" ? "Add supplies you physically hold that are not already recorded. All rows save together; property stock stays unchanged." : "Select holdings and quantities for one property. All selected deliveries save together, or none do."}</p>
    {action === "RECORD" ? <>
      {rows.map((row, index) => <fieldset key={index} disabled={locked} className="space-y-2 border-t pt-3 min-w-0"><legend className="text-sm pt-2">Item {index + 1}</legend>
        <ESelect aria-label={`Stock item ${index + 1}`} className="w-full min-w-0" value={row.itemId} onChange={event => setRows(current => current.map((value, i) => i === index ? { ...value, itemId: event.target.value } : value))}><option value="">Choose an item</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}{row.itemId && !items.some(item => item.id === row.itemId) ? <option value={row.itemId}>Previously selected item</option> : null}</ESelect>
        <EInput aria-label={`Quantity to record ${index + 1}`} placeholder="Quantity to record" type="number" min="0.000001" max="1000000" step="any" required value={row.quantity} onChange={event => setRows(current => current.map((value, i) => i === index ? { ...value, quantity: event.target.value } : value))} />
        <EInput aria-label={`Stock note ${index + 1}`} placeholder="Note (optional)" maxLength={2000} value={row.sourceNote} onChange={event => setRows(current => current.map((value, i) => i === index ? { ...value, sourceNote: event.target.value } : value))} />
        <EButton type="button" variant="ghost" className="min-h-11" disabled={rows.length === 1 || locked} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove item {index + 1}</EButton>
      </fieldset>)}
      <EButton type="button" variant="outline" disabled={locked || rows.length >= 50} className="min-h-11" onClick={() => setRows(current => [...current, { itemId: "", quantity: "", sourceNote: "" }])}>Add another item</EButton>
    </> : <>
      <ESelect aria-label="Bulk delivery property" value={propertyId} disabled={locked} className="w-full min-w-0" onChange={event => setPropertyId(event.target.value)}><option value="">Choose delivery property</option>{properties.map(property => <option value={property.id} key={property.id}>{property.name} · {property.suburb}</option>)}{propertyId && !properties.some(property => property.id === propertyId) ? <option value={propertyId}>Previously selected property</option> : null}</ESelect>
      {deliveryRows.length ? deliveryRows.map((held, index) => <div key={held.id} className="space-y-2 border-t pt-2 min-w-0"><label className="flex gap-2 items-start text-sm min-h-11 py-2"><input type="checkbox" className="mt-1" aria-label={`Select holding ${index + 1}`} checked={held.id in selected} disabled={locked || (!(held.id in selected) && Object.keys(selected).length >= 50)} onChange={event => setSelected(current => { const next = { ...current }; if (event.target.checked) next[held.id] = String(held.quantity); else delete next[held.id]; return next; })} /><span className="min-w-0 break-words">{held.item?.name ?? "Previously selected holding"} · {held.quantity} {held.item?.unit ?? "units"} {held.item ? "available" : "in pending request"} · entry {index + 1}</span></label>{held.id in selected ? <EInput aria-label={`Delivery quantity ${index + 1}`} type="number" min="0.000001" max={pending ? undefined : held.quantity} step="any" required disabled={locked} value={selected[held.id]} onChange={event => setSelected(current => ({ ...current, [held.id]: event.target.value }))} /> : null}</div>) : <p className="text-sm">No stock available for delivery.</p>}
    </>}
    {message ? <p role="status" className="text-sm break-words">{message}</p> : null}
    {pending && !busy ? <p className="text-sm">Confirmation is pending. Retry this exact batch; do not enter it again separately.</p> : null}
    <EButton type="submit" disabled={!ready || busy || (!pending && action === "DELIVER" && !Object.keys(selected).length)} className="min-h-11 h-auto whitespace-normal w-full">{busy ? "Saving batch…" : pending ? "Retry same stock batch" : action === "RECORD" ? `Record ${rows.length} ${rows.length === 1 ? "item" : "items"}` : `Deliver ${Object.keys(selected).length} selected holdings`}</EButton>
  </form>;
}
