"use client";
import * as React from "react";
import { useSession } from "next-auth/react";
import { EButton } from "@/components/v2/ui/primitives";
type Row = { id: string; propertyName: string; expectedCount: number; actualCount: number; reason: string; photoUrl: string; createdAt: string; resolvedAt: string | null; resolutionNote: string | null; version: number; laundryTaskId: string | null };
export function QuantityExceptions() {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return <p>Sign in to view bag quantity exceptions.</p>;
  return <ExceptionQueue key={JSON.stringify([session.user.id, session.user.role, session.impersonation?.actorId, session.impersonation?.mode, session.impersonation?.startedAt])} readOnly={!!session.impersonation} />;
}
function ExceptionQueue({ readOnly }: { readOnly: boolean }) {
  const [rows, setRows] = React.useState<Row[]>([]); const [total, setTotal] = React.useState(0); const [cursor, setCursor] = React.useState<string | null>(null);
  const [resolved, setResolved] = React.useState(false); const [canResolve, setCanResolve] = React.useState(false); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState("");
  const [notes, setNotes] = React.useState<Record<string, string>>({}); const sequence = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);
  const load = React.useCallback(async (next?: string) => {
    const request = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setError("");
    try { const response = await fetch(`/api/laundry/quantity-exceptions?resolved=${resolved}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { cache: "no-store", signal: abort.signal }); const body = await response.json(); if (!response.ok || !Array.isArray(body.rows) || !body.rows.every(validRow) || !Number.isInteger(body.total) || body.total < 0 || !(body.nextCursor === null || (typeof body.nextCursor === "string" && body.nextCursor.length > 0)) || typeof body.canResolve !== "boolean") throw new Error();
      if (request !== sequence.current) return; setRows(current => next ? [...current, ...body.rows] : body.rows); setTotal(body.total); setCursor(body.nextCursor); setCanResolve(body.canResolve === true);
    } catch { if (request === sequence.current) { setError("Quantity exceptions are unavailable. Refresh to try again."); setRows([]); } } finally { if (request === sequence.current) setBusy(false); }
  }, [resolved]);
  React.useEffect(() => { setRows([]); void load(); return () => { sequence.current++; controller.current?.abort(); }; }, [load]);
  async function resolve(row: Row) {
    if (busy || readOnly || error) return;
    setBusy(true); setError("");
    try { const response = await fetch("/api/laundry/quantity-exceptions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, version: row.version, note: notes[row.id] }) }); const body = await response.json(); if (!response.ok || body.id !== row.id || !body.resolvedAt) throw new Error(); await load(); }
    catch { setError("Resolution outcome is not confirmed. Refresh before trying again."); } finally { setBusy(false); }
  }
  return <section aria-label="Bag quantity exceptions" className="space-y-3 rounded border p-4">
    <h2 className="font-semibold">Bag quantity exceptions</h2>
    <p className="text-sm">Counts are snapshots recorded at pickup. Later corrections do not rewrite this exception.</p>
    <div className="flex flex-wrap gap-3"><label><input type="checkbox" checked={resolved} disabled={busy} onChange={event => setResolved(event.target.checked)} /> Show resolved</label><EButton variant="outline" disabled={busy} onClick={() => void load()}>Refresh exceptions</EButton></div>
    {error ? <p role="alert">{error}</p> : <p>{busy ? "Loading exceptions…" : `${total} ${resolved ? "resolved" : "open"} exceptions · ${rows.length} shown`}</p>}
    {rows.map(row => <article key={row.id} className="space-y-2 border-t pt-3"><h3>{row.propertyName}</h3><p>Expected {row.expectedCount} bags · Collected {row.actualCount} bags</p><p>{row.reason}</p><p className="text-sm">Recorded {new Date(row.createdAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} (Sydney)</p><a href={row.photoUrl} target="_blank" rel="noreferrer" className="underline">View discrepancy photo</a>{!row.laundryTaskId ? <p>Original task has been removed. This exception remains recorded.</p> : null}
      {row.resolvedAt ? <p>Resolved: {row.resolutionNote}</p> : canResolve && !readOnly ? <div className="space-y-2"><label className="block">Resolution note<textarea className="block w-full border p-2" value={notes[row.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [row.id]: event.target.value }))} /></label><EButton disabled={busy || !!error || (notes[row.id]?.trim().length ?? 0) < 3} onClick={() => void resolve(row)}>Resolve exception</EButton></div> : <p>Office review pending.</p>}
    </article>)}
    {cursor && !error ? <EButton disabled={busy} onClick={() => void load(cursor)}>Show more exceptions</EButton> : null}
  </section>;
}
function validRow(row: any): row is Row {
  return row && typeof row.id === "string" && row.id.length > 0 && typeof row.propertyName === "string" && [row.expectedCount, row.actualCount].every(value => Number.isInteger(value) && value >= 1 && value <= 50) && typeof row.reason === "string" && typeof row.photoUrl === "string" && /^https?:\/\//.test(row.photoUrl) && Number.isFinite(Date.parse(row.createdAt)) && (row.resolvedAt === null || Number.isFinite(Date.parse(row.resolvedAt))) && (row.resolutionNote === null || typeof row.resolutionNote === "string") && Number.isInteger(row.version) && row.version >= 0 && (row.laundryTaskId === null || typeof row.laundryTaskId === "string");
}
