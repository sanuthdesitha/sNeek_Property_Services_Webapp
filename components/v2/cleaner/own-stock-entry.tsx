"use client";
import { useEffect, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/cleaner/fields";
export type StockItem = { id: string; name: string; unit: string };
type Entry = { requestId: string; itemId?: string; quantity: number; sourceNote?: string; heldStockId?: string; expectedUpdatedAt?: string; reason?: string };
export function OwnStockEntry({ items, onSaved, scope, holding, apiPath = "/api/cleaner/inventory/held-stock", administrative = false }: { apiPath?: string; administrative?: boolean; holding?: { id: string; quantity: number; updatedAt: string }; scope: string; items: StockItem[]; onSaved: () => Promise<void> }) {
  const [itemId, setItemId] = useState(""), [quantity, setQuantity] = useState(holding ? String(holding.quantity) : ""), [note, setNote] = useState("");
  const [pending, setPending] = useState<Entry | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false);
  const storageKey = `cleaner-held-stock:${scope}${administrative ? ":admin" : ""}${holding ? `:adjust:${holding.id}` : ""}`;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try { const raw = sessionStorage.getItem(storageKey); if (raw) { const entry = JSON.parse(raw) as Entry; if (typeof entry.requestId !== "string" || !Number.isFinite(entry.quantity) || (holding ? entry.heldStockId !== holding.id || typeof entry.expectedUpdatedAt !== "string" || typeof entry.reason !== "string" : typeof entry.itemId !== "string" || typeof entry.sourceNote !== "string")) throw new Error("Invalid saved entry"); setPending(entry); setItemId(entry.itemId ?? ""); setQuantity(String(entry.quantity)); setNote(entry.reason ?? entry.sourceNote ?? ""); } setHydrated(true); }
    catch { setMessage("This browser cannot restore your pending entry. Enable browser storage before recording stock."); }
  }, [storageKey]);
  async function save() {
    if (lock.current || !hydrated) return;
    const value = Number(quantity);
    if (!pending && (!quantity.trim() || (!holding && !items.some(item => item.id === itemId)) || !Number.isFinite(value) || (holding ? value < 0 || note.trim().length < 3 : value <= 0) || value > 1_000_000)) { setMessage("Choose an item and valid quantity (up to 1,000,000). Adjustments allow zero and require a reason of at least 3 characters."); return; }
    const entry = pending ?? (holding ? { requestId: crypto.randomUUID(), heldStockId: holding.id, expectedUpdatedAt: holding.updatedAt, quantity: value, reason: note.trim() } : { requestId: crypto.randomUUID(), itemId, quantity: value, sourceNote: note.trim() });
    try { sessionStorage.setItem(storageKey, JSON.stringify(entry)); } catch { setMessage("Browser storage is unavailable. No stock was sent. Enable storage and try again."); return; }
    lock.current = true; setBusy(true); setPending(entry); setMessage("");
    try {
      const response = await fetch(apiPath, { method: holding ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
      const body = await response.json();
      if (!response.ok || body.ok !== true || typeof body.id !== "string") {
        if ([400, 403, 404, 409].includes(response.status)) { sessionStorage.removeItem(storageKey); setPending(null); }
        throw new Error(typeof body.error === "string" ? body.error : "Saving was not confirmed. Retry this same entry.");
      }
      sessionStorage.removeItem(storageKey); setPending(null); setItemId(""); setQuantity(""); setNote(""); setMessage(holding ? "Remaining quantity updated. Property stock has not changed." : "Stock recorded as held by you. Property stock has not changed.");
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Saving was not confirmed. Retry this same entry."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="space-y-3 rounded-lg border p-4 min-w-0" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3 className="font-semibold">{holding ? "Set remaining quantity" : "Record stock you hold"}</h3>
    {holding ? <p className="text-sm">{administrative ? "Enter the quantity this person currently holds in this entry, including zero. Give a reason. This does not deliver stock to a property." : "Enter what you currently hold in this entry, including zero if used up. Give a reason. This corrects your personal holding only; it does not deliver stock to a property."}</p> : <p className="text-sm">Add supplies you physically have that are not already listed below. This adds a new holding; it does not replace your total or change stock at a property.</p>}
    {!holding ? <label className="block text-sm">Item<ESelect aria-label="Stock item" className="mt-1 w-full min-w-0" value={itemId} disabled={busy || !!pending} onChange={event => setItemId(event.target.value)}><option value="">Choose an item</option>{items.map(item => <option value={item.id} key={item.id}>{item.name} ({item.unit})</option>)}</ESelect></label> : null}
    <label className="block text-sm">{holding ? "Remaining quantity" : "Quantity to add"}<EInput aria-label={holding ? "Remaining quantity" : "Quantity to add"} type="number" required min={holding ? "0" : "0.01"} max="1000000" step="any" value={quantity} disabled={busy || !!pending} onChange={event => setQuantity(event.target.value)} /></label>
    <label className="block text-sm">{holding ? "Reason for adjustment" : "Note (optional)"}<EInput aria-label={holding ? "Reason for adjustment" : "Stock note"} maxLength={2000} value={note} disabled={busy || !!pending} onChange={event => setNote(event.target.value)} /></label>
    {message ? <p role="status" className="text-sm break-words">{message}</p> : null}
    {pending && !busy ? <p className="text-sm">Confirmation is pending. Retry the same entry to avoid recording it twice.</p> : null}
    <EButton type="submit" disabled={!hydrated || busy || (!pending && !holding && !items.length)} className="min-h-11 h-auto whitespace-normal">{busy ? "Recording…" : pending ? "Retry same stock entry" : holding ? "Save remaining quantity" : "Record my stock"}</EButton>
  </form>;
}
