"use client";
import { useEffect, useState } from "react";

type Status = {
  worker?: { status: "ACTIVE" | "STALE" | "MISSING"; lastSeenAt: string | null; mobileDispatcherActive: boolean };
  hasMore: boolean;
  mobile: Array<{ id: string; subject: string | null; status: string; detail: string | null }>;
  attempts: Array<{ id: string; event: string; status: string; needsReview: boolean }>;
};
export function NotificationDispatchStatus() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/admin/notifications/dispatch-status", { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("unavailable"); return response.json(); })
      .then(value => { if (active) setData(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const attention = data?.mobile.filter(item => ["FAILED", "UNCERTAIN", "REVIEW_REQUIRED"].includes(item.status)) ?? [];
  const claims = data?.attempts.filter(item => item.needsReview) ?? [];
  return <section className="space-y-2 rounded-md border p-3 text-sm" aria-label="Delivery review">
    <h3 className="font-medium">Delivery review</h3>
    <p>Mobile messages wait for the dedicated worker. Provider acceptance does not confirm delivery or reading. Uncertain attempts are held for review and are never automatically resent.</p>
    {error ? <p role="alert">Delivery status is unavailable. Refresh to try again.</p> : !data ? <p>Loading recent delivery status…</p> : <>
      {data.worker?.status === "MISSING" ? <p role="alert">No dedicated worker heartbeat is recorded. Queued messages may wait indefinitely until the worker is started.</p> : data.worker?.status === "STALE" ? <p role="alert">The dedicated worker heartbeat is stale. Check the worker before assuming queued messages are being processed.</p> : data.worker && !data.worker.mobileDispatcherActive ? <p role="alert">A worker is live, but mobile notification dispatch is disabled.</p> : data.worker ? <p>Dedicated worker heartbeat is current. This confirms liveness, not delivery.</p> : null}
      <p>{data.mobile.length} recent mobile records; {attention.length + claims.length} recent items need review.{data.hasMore ? " More history exists." : ""}</p>
      <ul className="list-disc pl-5">
        {attention.map(item => <li key={item.id}>{item.subject || "Notification"}: {item.status.replaceAll("_", " ").toLowerCase()}. {item.detail}</li>)}
        {claims.map(item => <li key={item.id}>{item.event}: delivery attempt needs review. Check individual channel logs before retrying.</li>)}
      </ul>
    </>}
  </section>;
}
