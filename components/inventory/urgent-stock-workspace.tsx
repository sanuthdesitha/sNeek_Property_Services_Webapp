"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UrgentNeed } from "@/lib/inventory/urgent-stock";
import { isUrgentStockClosed, type UrgentStockStage } from "@/lib/inventory/urgent-stock-policy";

type Settings = { enabled: boolean; intervalHours: number; maxReminders: number; beforeNextCleanHours: number };
type Snapshot = { properties: { id: string; name: string }[]; items: { itemId: string; item: { name: string; unit: string } }[]; reports: UrgentNeed[]; settings: Settings | null; nextCleanAt?: string | null };
const LABEL: Record<UrgentStockStage, string> = { REPORTED: "Reported", ACKNOWLEDGED: "Acknowledged", ORDERED: "Order recorded", DELIVERED: "Delivery recorded", PROPERTY_CONFIRMED: "Confirmed at property", ADMIN_RESOLVED: "Resolved by administrator" };
const style = "block w-full rounded border p-2";
const countValue = (value: string) => value.trim() === "" ? null : Number(value);
const timestamp = (value: string) => value ? new Date(value).toISOString() : null;
type Post = (input: Record<string, unknown>) => Promise<void>;
export function UrgentStockWorkspace({ isAdmin, initialPropertyId = "" }: { isAdmin: boolean; initialPropertyId?: string }) {
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [data, setData] = useState<Snapshot>({ properties: [], items: [], reports: [], settings: null });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [itemId, setItemId] = useState(""); const [observed, setObserved] = useState(""); const [observedAt, setObservedAt] = useState("");
  const [purchase, setPurchase] = useState(""); const [note, setNote] = useState("");
  const receipts = useRef(new Map<string, string>());
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/inventory/urgent-stock?propertyId=${encodeURIComponent(propertyId)}`, { cache: "no-store", signal });
    const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body);
  }, [propertyId]);
  useEffect(() => { const controller = new AbortController(); setData(previous => ({ ...previous, items: [], reports: [] })); void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, [load]);
  const post: Post = async input => {
    setBusy(true); setError("");
    try {
      const fingerprint = JSON.stringify(input);
      const requestId = receipts.current.get(fingerprint) ?? crypto.randomUUID(); receipts.current.set(fingerprint, requestId);
      const response = await fetch("/api/inventory/urgent-stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.action === "settings" ? input : { ...input, requestId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      // Retain the receipt through a failed refresh, so retry cannot duplicate it.
      await load(); receipts.current.delete(fingerprint);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); throw e; }
    finally { setBusy(false); }
  };
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Urgent stock</h1>
    <p>Report supplies needed at a property. Leave unknown quantities blank. Recording an order does not place one; acknowledgement and delivery stay open until the need is resolved.</p>
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    <label>Property<select className={style} value={propertyId} disabled={busy} onChange={e => { setPropertyId(e.target.value); setItemId(""); setObserved(""); setObservedAt(""); setPurchase(""); setNote(""); setError(""); }}><option value="">Choose property</option>{data.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {propertyId && data.items.length ? <form className="space-y-3 rounded border p-4" onSubmit={e => { e.preventDefault(); void post({ action: "report", propertyId, itemId, observedCount: countValue(observed), observedAt: timestamp(observedAt), purchaseQuantity: countValue(purchase), note }).then(() => { setNote(""); setObserved(""); setObservedAt(""); setPurchase(""); }).catch(() => {}); }}>
      <h2 className="font-semibold">Report a need</h2>
      <label>Item<select className={style} required value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Choose item</option>{data.items.map(i => <option key={i.itemId} value={i.itemId}>{i.item.name} ({i.item.unit})</option>)}</select></label>
      <label>Observed count (blank = unknown)<input className={style} type="number" min="0" max="1000000" step="any" value={observed} onChange={e => setObserved(e.target.value)} /></label>
      <label>When you observed that count<input className={style} type="datetime-local" step="1" required={observed !== ""} value={observedAt} onChange={e => setObservedAt(e.target.value)} /></label>
      <label>Requested purchase quantity (blank = unknown)<input className={style} type="number" min="0.001" max="1000000" step="any" value={purchase} onChange={e => setPurchase(e.target.value)} /></label>
      <label>What is needed and why?<textarea className={style} required maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button className="rounded border p-2" disabled={busy}>Save report</button>
    </form> : propertyId ? <p>No configured inventory items available.</p> : null}
    {data.nextCleanAt ? <p>Next clean planning deadline: {new Date(data.nextCleanAt).toLocaleString()}. An unspecified clean time uses the start of its local day.</p> : propertyId ? <p>No upcoming clean is currently scheduled.</p> : null}
    <section className="space-y-4"><h2 className="font-semibold">Reports and recorded actions</h2>
      {data.reports.map(report => <Need key={report.id} report={report} isAdmin={isAdmin} busy={busy} post={post} />)}
      {propertyId && !data.reports.length ? <p>No reports for this property.</p> : null}
    </section>
    {isAdmin && data.settings ? <ReminderSettings key={JSON.stringify(data.settings)} settings={data.settings} busy={busy} post={post} /> : null}
  </main>;
}
function Need({ report, isAdmin, busy, post }: { report: UrgentNeed; isAdmin: boolean; busy: boolean; post: Post }) {
  const [stage, setStage] = useState<UrgentStockStage>("PROPERTY_CONFIRMED"); const [reason, setReason] = useState("");
  const [count, setCount] = useState(""); const [observedAt, setObservedAt] = useState(""); const [resolved, setResolved] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null); const [historyError, setHistoryError] = useState("");
  useEffect(() => { setStage("PROPERTY_CONFIRMED"); }, [report.stage]);
  const next: Partial<Record<UrgentStockStage, UrgentStockStage>> = { REPORTED: "ACKNOWLEDGED", ACKNOWLEDGED: "ORDERED", ORDERED: "DELIVERED" };
  async function showHistory() {
    try { const response = await fetch(`/api/inventory/urgent-stock?propertyId=${encodeURIComponent(report.propertyId)}&reportId=${report.id}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setHistory(body.events); }
    catch (e) { setHistoryError(e instanceof Error ? e.message : "History unavailable"); }
  }
  return <article className="space-y-3 rounded border p-4">
    <h3 className="font-semibold">{report.itemName} — {LABEL[report.stage]}</h3><p>{report.note}</p>
    <p>Reported count: {report.observedCount ?? "unknown"} {report.unit}; requested purchase: {report.purchaseQuantity ?? "unknown"} {report.unit}.</p>
    <p>{report.observedAt ? `Observed ${new Date(report.observedAt).toLocaleString()}. ` : ""}{report.observationDisposition === "APPLY" ? "Observation applied to stock when recorded." : `Stock unchanged (${report.observationDisposition.toLowerCase()}).`} This report is not a live stock balance.</p>
    {!isUrgentStockClosed(report.stage) ? <form className="space-y-2" onSubmit={e => { e.preventDefault(); void post({ action: "transition", reportId: report.id, expectedVersion: report.version, stage, reason, observedCount: stage === "PROPERTY_CONFIRMED" ? countValue(count) : null, observedAt: stage === "PROPERTY_CONFIRMED" ? timestamp(observedAt) : null, needResolved: stage === "PROPERTY_CONFIRMED" && resolved }).then(() => { setReason(""); setHistory(null); }).catch(() => {}); }}>
      <label>Record action<select className={style} value={stage} onChange={e => setStage(e.target.value as UrgentStockStage)}>
        {next[report.stage] ? <option value={next[report.stage]}>{LABEL[next[report.stage]!]}</option> : null}
        <option value="PROPERTY_CONFIRMED">Confirm need resolved at property</option>{isAdmin ? <option value="ADMIN_RESOLVED">Resolve with administrator explanation</option> : null}
      </select></label>
      {stage === "PROPERTY_CONFIRMED" ? <>
        <label>Fresh observed count<input className={style} required type="number" min="0.001" max="1000000" step="any" value={count} onChange={e => setCount(e.target.value)} /></label>
        <label>Observation time<input className={style} required type="datetime-local" step="1" value={observedAt} onChange={e => setObservedAt(e.target.value)} /></label>
        <label className="block"><input required type="checkbox" checked={resolved} onChange={e => setResolved(e.target.checked)} /> I checked the property and this need is resolved</label>
      </> : null}
      <label>Action reason<textarea className={style} required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="rounded border p-2" disabled={busy}>Record action</button>
    </form> : <p>Closed with a recorded resolution; earlier actions remain in history.</p>}
    <button className="underline" onClick={() => void showHistory()}>View history</button>{historyError ? <p role="alert">{historyError}</p> : null}
    {history ? <ol>{history.map((event, i) => <li key={i} className="border-t py-2">
      {new Date(event.at).toLocaleString()} — {LABEL[event.kind as UrgentStockStage] ?? event.kind.replaceAll("_", " ").toLowerCase()} · {event.actorName}
      <p>{event.detail.reason ?? event.detail.note ?? `Reminder ${event.detail.number}`}</p>
      {"observedCount" in event.detail ? <p>Observed count: {event.detail.observedCount ?? "unknown"}{event.detail.observedAt ? ` at ${new Date(event.detail.observedAt).toLocaleString()}` : ""}.</p> : null}
      {"purchaseQuantity" in event.detail ? <p>Requested purchase: {event.detail.purchaseQuantity ?? "unknown"}.</p> : null}
      {event.detail.observationDisposition ? <p>Count outcome: {event.detail.observationDisposition.toLowerCase()}.</p> : null}
    </li>)}</ol> : null}
  </article>;
}
function ReminderSettings({ settings, busy, post }: { settings: Settings; busy: boolean; post: Post }) {
  const [value, setValue] = useState(settings);
  return <form className="space-y-3 rounded border p-4" onSubmit={e => { e.preventDefault(); void post({ action: "settings", ...value }).catch(() => {}); }}>
    <h2 className="font-semibold">Administrator reminders</h2><p>In-app reminders for unresolved needs. A running background worker is required. No emails or automatic purchases.</p>
    <label className="block"><input type="checkbox" checked={value.enabled} onChange={e => setValue({ ...value, enabled: e.target.checked })} /> Enable reminders</label>
    {([['intervalHours', 'Repeat every (hours)', 1, 168], ['maxReminders', 'Maximum reminders per need', 0, 20], ['beforeNextCleanHours', 'Advance reminder within hours of next clean', 1, 168]] as const).map(([key, label, min, max]) => <label key={key} className="block">{label}<input className={style} required type="number" min={min} max={max} value={value[key]} onChange={e => setValue({ ...value, [key]: Number(e.target.value) })} /></label>)}
    <button className="rounded border p-2" disabled={busy}>Save reminder settings</button>
  </form>;
}
