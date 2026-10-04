"use client";
import { OperationsPanel, OperationsButton, OperationsNotice, OperationsLoading } from "@/components/operations/ui";
import { useEffect, useState } from "react";
import type { StayPreparation } from "@/lib/inventory/stay-preparation";
import { emptyStayPolicy, type StayPreparationPolicy } from "@/lib/inventory/stay-preparation-policy";
import { stayPreparationPrintHtml } from "@/lib/inventory/stay-preparation-report";
export function StayPreparationPanel({ propertyId, jobId, isAdmin = false, items = [], refreshToken, embedded = false, onError }: { embedded?: boolean; onError?: () => void; propertyId: string; jobId?: string; refreshToken?: string; isAdmin?: boolean; items?: Array<{ itemId: string; item: { name: string; unit: string } }> }) {
  const [loaded, setLoaded] = useState(false);
  const [policy, setPolicy] = useState<StayPreparationPolicy>(emptyStayPolicy);
  const [plans, setPlans] = useState<StayPreparation[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const url = `/api/inventory/stay-preparation?propertyId=${encodeURIComponent(propertyId)}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`;
  useEffect(() => {
    const controller = new AbortController(); setPlans([]); setError(""); setLoaded(false);
    void fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw Error(body.error); if (!Array.isArray(body.plans) || !body.policy) throw Error("Preparation response unavailable. Retry after reloading."); if (!controller.signal.aborted) { setPlans(body.plans); setPolicy(body.policy); setLoaded(true); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [url, refreshToken]);
  useEffect(() => { if (error) onError?.(); }, [error, onError]);
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inventory/stay-preparation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId, policy }) });
      const body = await response.json(); if (!response.ok) throw Error(body.error);
      const refreshed = await fetch(url, { cache: "no-store" }); const data = await refreshed.json(); if (!refreshed.ok) throw Error(data.error); setPlans(data.plans); setPolicy(data.policy); setNotice("Preparation rules saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  return <OperationsPanel embedded={embedded} label="Incoming stay preparation" accent={isAdmin ? "admin" : "cleaner"}>
    {!embedded ? <h2 className="font-semibold">Incoming stay preparation</h2> : null}
    {error ? <OperationsNotice tone="danger">{error}</OperationsNotice> : null}
    {!loaded && !error ? <OperationsLoading label="Loading stay preparation…" /> : null}
    {notice ? <OperationsNotice tone="success">{notice}</OperationsNotice> : null}{busy ? <OperationsNotice>Saving changes…</OperationsNotice> : null}
    {plans.map(plan => <article key={plan.jobId} className="space-y-4">
      <h3>Stay preparation — planning estimate</h3>
      <p>Incoming stay: {plan.startDate ?? "Unknown"} to {plan.endDate ?? "Unknown"}; {plan.nights ?? "Unknown"} nights ({plan.staySource}).</p>
      <p>{embedded ? "Estimate guest basis:" : "Prepare for:"} {plan.guests ?? "Unknown"} guests ({plan.guestBasis === "PROPERTY_MAX" ? "property maximum fallback; booking count unknown" : plan.guestBasis.replaceAll("_", " ").toLowerCase()}).</p>
      <p className="ops-inset">{plan.towelInstruction}</p>
      <p className="text-sm">Planning only. Estimates do not deduct inventory, reserve stock, place orders or confirm completion. Unrecorded supply remains unknown.</p>
      {plan.rows.map(row => <section key={row.itemId} className="ops-inset space-y-3"><h4 className="font-semibold">{row.name} ({row.unit})</h4>
        <dl className="grid grid-cols-2 gap-3 text-sm">{[["Estimated demand",row.estimated],["Verified available",row.available],["Cleaner-reported supplied / used",row.supplied],["Remaining estimate",row.remaining]].map(([label,value]) => <div key={String(label)}><dt>{label}</dt><dd className="mt-1 text-lg font-semibold">{value ?? "Unknown"}</dd></div>)}</dl>
        <details><summary>Stock evidence and source</summary><p className="text-sm">{row.reliability}. Observed: {row.observedAt ?? "Unknown"}. Ledger deduction for this job: {row.ledgerUsed ?? "Unknown"}. Ledger balance: {row.ledgerCount} at {row.ledgerAt}. A ledger deduction alone does not prove supply. Urgent report: {row.reportId ?? "None"}{row.reportStage ? ` (${row.reportStage})` : ""}.</p></details>
      </section>)}
      <details><summary>Estimate details</summary><p className="text-xs">Job: {plan.jobId}. Generated: {plan.generatedAt}. Remaining estimate is demand less cleaner-reported supply or usage.</p></details>
    </article>)}
    {loaded && !plans.length && !error ? <p>No associated job preparation available.</p> : null}
    {plans.length ? <OperationsButton variant="outline" className="print:hidden" type="button" onClick={() => { const popup = window.open("", "_blank"); if (!popup) { setError("Allow the print window to export this estimate."); return; } popup.opener = null; popup.document.write(stayPreparationPrintHtml(plans)); popup.document.close(); popup.focus(); popup.print(); }}>Print / save estimate as PDF</OperationsButton> : null}
    {isAdmin && loaded ? <form className="space-y-2 border-t pt-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      <h3 className="font-semibold">Property preparation rules</h3><p>Estimate = per-stay units + guests × nights × units per guest-night, rounded up. Set only items this property needs. Empty towel quantity means office confirmation is required for stays over 14 nights.</p>
      <label className="block">Extra towels for stays over 14 nights (whole stay)<input aria-label="Extra towels for stays over 14 nights" className="w-full sm:w-auto" type="number" min="0" max="100" value={policy.extraTowels ?? ""} onChange={e => setPolicy({ ...policy, extraTowels: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      {items.map(item => { const rule = policy.items.find(row => row.itemId === item.itemId); return <fieldset key={item.itemId} ><legend>{item.item.name} ({item.item.unit})</legend>
        <label><input type="checkbox" checked={!!rule} onChange={e => setPolicy({ ...policy, items: e.target.checked ? [...policy.items, { itemId: item.itemId, perStay: 0, perGuestNight: 0 }] : policy.items.filter(row => row.itemId !== item.itemId) })} /> Include estimate</label>
        {rule ? ([['perStay','Units per stay'],['perGuestNight','Units per guest-night']] as const).map(([key,label]) => <label className="block" key={key}>{label}<input aria-label={`${item.item.name}: ${label}`} className="w-full sm:w-auto" type="number" min="0" max="10000" step="any" required value={rule[key]} onChange={e => setPolicy({ ...policy, items: policy.items.map(row => row.itemId === item.itemId ? { ...row, [key]: Number(e.target.value) } : row) })} /></label>) : null}
      </fieldset>; })}
      <OperationsButton  disabled={busy}>Save preparation rules</OperationsButton>
    </form> : null}
  </OperationsPanel>;
}
