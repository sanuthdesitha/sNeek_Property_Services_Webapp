"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
type Charge = { id: string; revision: number; expenseAmount: number; expenseBillable: boolean; shoppingMinutes: number; allocatedMinutes: number; hourlyRate: number | null; labourAmount: number; treatment: "PENDING" | "AGENCY_DISBURSEMENT" | "RECHARGE"; status: "DRAFT" | "APPROVED"; invoiceId: string | null; reviewNote: string | null; property: { name: string }; client: { name: string } };
const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
export function ShoppingClientCharges({ runId }: { runId: string }) {
  const [charges, setCharges] = useState<Charge[]>([]), [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const response = await fetch(`/api/admin/inventory/shopping-runs/${runId}/client-charges`, { cache: "no-store" });
      const body = await response.json();
      if (request !== generation.current) return;
      if (!response.ok || !Array.isArray(body.charges)) throw new Error(body.error || "Client charges unavailable.");
      setCharges(body.charges); setError("");
    } catch (failure) { if (request === generation.current) setError(failure instanceof Error ? failure.message : "Client charges unavailable."); }
  }, [runId]);
  useEffect(() => { setCharges([]); void refresh(); return () => { generation.current++; }; }, [refresh]);
  return <ECard className="space-y-3 p-4">
    <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Client purchases and shopping time</h2><EButton variant="outline" onClick={() => void refresh()}>Refresh charges</EButton></div>
    <p className="text-sm">Review each client allocation before its next invoice. The client hourly rate is separate from cleaner pay. General stock is allocated when delivered to a property.</p>
    {error ? <p role="alert">{error}</p> : !charges.length ? <p className="text-sm">No client allocations yet. Complete a property shopping run or deliver general stock to a property.</p> : null}
    {charges.map(charge => <ChargeEditor key={`${charge.id}:${charge.revision}`} charge={charge} runId={runId} refresh={refresh} />)}
  </ECard>;
}
function ChargeEditor({ charge, runId, refresh }: { charge: Charge; runId: string; refresh: () => Promise<void> }) {
  const [minutes, setMinutes] = useState(String(charge.shoppingMinutes)), [rate, setRate] = useState(charge.hourlyRate == null ? "" : String(charge.hourlyRate));
  const [treatment, setTreatment] = useState(charge.treatment), [note, setNote] = useState(charge.reviewNote ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [expenseBillable, setExpenseBillable] = useState(charge.expenseBillable ?? true);
  async function save(status: "DRAFT" | "APPROVED") {
    setBusy(true); setError("");
    try {
      if (!minutes.trim()) throw new Error("Enter the minutes to charge, including zero if waived.");
      const response = await fetch(`/api/admin/inventory/shopping-runs/${runId}/client-charges`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: charge.id, expectedRevision: charge.revision, shoppingMinutes: Number(minutes), hourlyRate: rate.trim() ? Number(rate) : null, treatment, status, expenseBillable, reviewNote: note }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Approval not confirmed. Refresh charges before retrying.");
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Approval not confirmed."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 rounded border p-3">
    <h3 className="font-medium break-words">{charge.client.name} · {charge.property.name}</h3>
    <p className="text-sm">Purchases: {money(charge.expenseAmount)} · Shopping time: {charge.shoppingMinutes} minutes · Time charge: {money(charge.labourAmount)}</p>
    {charge.invoiceId ? <p>Included in an invoice. This charge is locked.</p> : <>
      <p className="text-sm">{charge.status === "APPROVED" ? "Approved for the next invoice" : "Awaiting billing review"}</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={expenseBillable} onChange={event => setExpenseBillable(event.target.checked)} disabled={busy} />Bill purchase cost to client</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Minutes to charge (up to {charge.allocatedMinutes})<EInput aria-label={`Minutes for ${charge.id}`} type="number" min="0" max={charge.allocatedMinutes} step="1" value={minutes} onChange={event => setMinutes(event.target.value)} disabled={busy} /></label>
        <label className="text-sm">Client hourly rate (AUD)<EInput aria-label={`Client rate for ${charge.id}`} type="number" min="0" step="0.01" value={rate} onChange={event => setRate(event.target.value)} disabled={busy} /></label>
      </div>
      <label className="block text-sm">Purchase accounting treatment<ESelect aria-label={`Treatment for ${charge.id}`} value={treatment} onChange={event => setTreatment(event.target.value as Charge["treatment"])} disabled={busy}>
        <option value="PENDING">Pending accounting review</option><option value="AGENCY_DISBURSEMENT">Exact-cost client agency disbursement</option><option value="RECHARGE">Ordinary expense recharge</option>
      </ESelect></label>
      <p className="text-xs">Use agency disbursement only where you purchased as the client's agent. It is excluded from sales income and the GST base. Shopping-time services remain separate.</p>
      <label className="block text-sm">Review note (required for agency disbursement or waived cost)<EInput value={note} maxLength={2000} onChange={event => setNote(event.target.value)} disabled={busy} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><EButton disabled={busy} variant="outline" onClick={() => void save("DRAFT")}>Save pending review</EButton><EButton disabled={busy || treatment === "PENDING" || (Number(minutes) > 0 && !rate.trim()) || ((treatment === "AGENCY_DISBURSEMENT" || !expenseBillable) && note.trim().length < 3)} onClick={() => void save("APPROVED")}>Approve for next invoice</EButton></div>
    </>}
  </div>;
}
