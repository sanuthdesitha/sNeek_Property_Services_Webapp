"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { z } from "zod";

const attemptSchema = z.object({ number: z.number().int().positive(), status: z.string(), providerReference: z.string().nullable(), errorCode: z.string().nullable(), startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable() });
const itemSchema = z.object({ id: z.string(), eventKey: z.string(), recipientId: z.string(), transport: z.string(), status: z.string(), subject: z.string().nullable(), severity: z.string().nullable(), attemptCount: z.number().int().nonnegative(), nextAttemptAt: z.string().datetime().nullable(), updatedAt: z.string().datetime(), lastErrorCode: z.string().nullable(), attempts: z.array(attemptSchema) });
const pageSchema = z.object({ items: z.array(itemSchema), hasMore: z.boolean() });
type Item = z.infer<typeof itemSchema>;
const button = "min-h-11 rounded border px-3 py-2 text-sm disabled:opacity-50";

export function NotificationIntentQueue() {
  const { data: session } = useSession();
  return <IntentQueue key={JSON.stringify([session?.user?.id, session?.user?.role, session?.impersonation])} readOnly={Boolean(session?.impersonation)} />;
}
function IntentQueue({ readOnly }: { readOnly: boolean }) {
  const [filter, setFilter] = useState("ATTENTION");
  const [page, setPage] = useState<z.infer<typeof pageSchema> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    let disposed = false; const controller = new AbortController();
    setLoading(true); setPage(null); setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/notifications/intents?status=${filter}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load delivery queue. Refresh to retry.");
        const result = pageSchema.parse(await response.json());
        if (!disposed) setPage(result);
      } catch { if (!disposed) setError("Could not load delivery queue. Refresh to retry."); }
      finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; controller.abort(); };
  }, [filter, refresh]);
  async function review(item: Item, action: string) {
    if (readOnly || locked.current || !notes[item.id]?.trim()) return;
    locked.current = true; setSaving(true); setError(null);
    try {
      const response = await fetch("/api/admin/notifications/intents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, updatedAt: item.updatedAt, action, note: notes[item.id].trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Review could not be confirmed. Refresh before retrying.");
      if (result.id !== item.id || !["FAILED", "UNCERTAIN", "RETRY_WAIT", "ACCEPTED"].includes(result.status) || !Number.isFinite(Date.parse(result.updatedAt))) throw new Error("Review could not be confirmed. Refresh before retrying.");
      setRefresh(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Review could not be confirmed. Refresh before retrying."); }
    finally { locked.current = false; setSaving(false); }
  }
  return <section aria-label="Durable delivery queue" className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-lg font-semibold">Durable delivery queue</h2>
      <select aria-label="Delivery queue status" className={button} value={filter} disabled={saving} onChange={event => setFilter(event.target.value)}>
        <option value="ATTENTION">Failed or uncertain</option><option value="QUEUED">Queued or processing</option><option value="ACCEPTED">Accepted</option><option value="SKIPPED">Skipped</option>
      </select>
      <button type="button" className={button} disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>Refresh queue</button>
    </div>
    <p className="text-sm">New events only. Inbox delivery runs in batches every five minutes. Provider acceptance does not confirm human receipt. Uncertain external sends require investigation and cannot be blindly retried.</p>
    {readOnly ? <p>Review actions are disabled while impersonating.</p> : null}
    {loading ? <p role="status">Loading delivery queue...</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {page && !page.items.length ? <p>No matching delivery intents.</p> : null}
    {page?.hasMore ? <p>Showing the latest 100 matching intents. Older intents are not shown.</p> : null}
    <ul className="space-y-4">{page?.items.map(item => <li key={item.id} className="space-y-2 rounded border p-4 [overflow-wrap:anywhere]">
      <h3 className="font-semibold">{item.subject ?? item.eventKey}</h3>
      <p className="text-sm">{item.transport} · {item.status} · {item.attemptCount}/5 attempts</p>
      <p className="text-xs">Event {item.eventKey} · Recipient {item.recipientId}</p>
      {item.nextAttemptAt ? <p className="text-xs">Eligible after {new Date(item.nextAttemptAt).toLocaleString()}</p> : null}
      {item.lastErrorCode ? <p className="text-sm">{item.lastErrorCode}</p> : null}
      <details><summary className="min-h-9 cursor-pointer">Attempt receipts</summary><ol>{item.attempts.map(attempt => <li key={attempt.number} className="py-1 text-xs">Attempt {attempt.number}: {attempt.status} · {new Date(attempt.startedAt).toLocaleString()}{attempt.providerReference ? ` · Provider reference ${attempt.providerReference}` : " · No provider reference recorded"}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</li>)}</ol></details>
      {!readOnly && ["FAILED", "UNCERTAIN"].includes(item.status) ? <div className="space-y-2">
        <label className="block text-sm">Investigation note<textarea aria-label={`Investigation note for ${item.id}`} maxLength={1000} className="mt-1 block min-h-20 w-full rounded border bg-transparent p-2" value={notes[item.id] ?? ""} onChange={event => setNotes(previous => ({ ...previous, [item.id]: event.target.value }))} /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={saving || !notes[item.id]?.trim()} onClick={() => void review(item, "RECORD_INVESTIGATION")}>Record investigation</button>
          {item.transport === "INBOX" ? <button type="button" className={button} disabled={saving || !notes[item.id]?.trim()} onClick={() => void review(item, "RECONCILE_INBOX")}>Reconcile inbox receipt</button> : null}
          {item.status === "FAILED" && item.attempts.at(-1)?.status === "NOT_ACCEPTED" && item.attemptCount < 5 ? <button type="button" className={button} disabled={saving || !notes[item.id]?.trim()} onClick={() => void review(item, "RETRY_KNOWN_REJECTION")}>Retry known rejection</button> : null}
        </div>
        <p className="text-xs">Recording an investigation preserves the delivery outcome. Inbox reconciliation checks the atomic receipt before allowing a local retry.</p>
      </div> : null}
    </li>)}</ul>
  </section>;
}
