"use client";
import { useEffect, useState } from "react";
import type { StayPreparation } from "@/lib/inventory/stay-preparation";
import { emptyStayPolicy, type StayPreparationPolicy } from "@/lib/inventory/stay-preparation-policy";
import { stayPreparationText, stayPreparationPrintHtml } from "@/lib/inventory/stay-preparation-report";
export function StayPreparationPanel({ propertyId, jobId, isAdmin = false, items = [], refreshToken }: { propertyId: string; jobId?: string; refreshToken?: string; isAdmin?: boolean; items?: Array<{ itemId: string; item: { name: string; unit: string } }> }) {
  const [loaded, setLoaded] = useState(false);
  const [policy, setPolicy] = useState<StayPreparationPolicy>(emptyStayPolicy);
  const [plans, setPlans] = useState<StayPreparation[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const url = `/api/inventory/stay-preparation?propertyId=${encodeURIComponent(propertyId)}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`;
  useEffect(() => {
    const controller = new AbortController(); setPlans([]); setError(""); setLoaded(false);
    void fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw Error(body.error); if (!Array.isArray(body.plans) || !body.policy) throw Error("Preparation response unavailable. Retry after reloading."); if (!controller.signal.aborted) { setPlans(body.plans); setPolicy(body.policy); setLoaded(true); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [url, refreshToken]);
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/stay-preparation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId, policy }) });
      const body = await response.json(); if (!response.ok) throw Error(body.error);
      const refreshed = await fetch(url, { cache: "no-store" }); const data = await refreshed.json(); if (!refreshed.ok) throw Error(data.error); setPlans(data.plans); setPolicy(data.policy);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded border p-4">
    <h2 className="font-semibold">Incoming stay preparation</h2>
    {error ? <p role="alert">{error}</p> : null}
    {plans.map(plan => <pre key={plan.jobId} className="whitespace-pre-wrap font-sans text-sm">{stayPreparationText(plan)}</pre>)}
    {!plans.length && !error ? <p>No associated job preparation available.</p> : null}
    {plans.length ? <button className="rounded border p-2" type="button" onClick={() => { const popup = window.open("", "_blank"); if (!popup) { setError("Allow the print window to export this estimate."); return; } popup.opener = null; popup.document.write(stayPreparationPrintHtml(plans)); popup.document.close(); popup.focus(); popup.print(); }}>Print / save estimate as PDF</button> : null}
    {isAdmin && loaded ? <form className="space-y-2 border-t pt-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      <h3 className="font-semibold">Property preparation rules</h3><p>Estimate = per-stay units + guests × nights × units per guest-night, rounded up. Set only items this property needs. Empty towel quantity means office confirmation is required for stays over 14 nights.</p>
      <label className="block">Extra towels for stays over 14 nights (whole stay)<input aria-label="Extra towels for stays over 14 nights" className="block rounded border p-2" type="number" min="0" max="100" value={policy.extraTowels ?? ""} onChange={e => setPolicy({ ...policy, extraTowels: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      {items.map(item => { const rule = policy.items.find(row => row.itemId === item.itemId); return <fieldset key={item.itemId} className="rounded border p-2"><legend>{item.item.name} ({item.item.unit})</legend>
        <label><input type="checkbox" checked={!!rule} onChange={e => setPolicy({ ...policy, items: e.target.checked ? [...policy.items, { itemId: item.itemId, perStay: 0, perGuestNight: 0 }] : policy.items.filter(row => row.itemId !== item.itemId) })} /> Include estimate</label>
        {rule ? ([['perStay','Units per stay'],['perGuestNight','Units per guest-night']] as const).map(([key,label]) => <label className="block" key={key}>{label}<input aria-label={`${item.item.name}: ${label}`} className="block rounded border p-2" type="number" min="0" max="10000" step="any" required value={rule[key]} onChange={e => setPolicy({ ...policy, items: policy.items.map(row => row.itemId === item.itemId ? { ...row, [key]: Number(e.target.value) } : row) })} /></label>) : null}
      </fieldset>; })}
      <button className="rounded border p-2" disabled={busy}>Save preparation rules</button>
    </form> : null}
  </section>;
}
