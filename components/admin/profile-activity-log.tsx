"use client";

import { useEffect, useState } from "react";

type ActivityItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
};

export function ProfileActivityLog({ endpoint, title = "Activity" }: { endpoint: string; title?: string }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(endpoint, { cache: "no-store" })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body.error ?? "Could not load activity.");
        setItems(Array.isArray(body.items) ? body.items : []);
      })
      .catch((err: any) => {
        setError(err.message ?? "Could not load activity.");
      })
      .finally(() => setLoading(false));
  }, [endpoint]);

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">Recent account actions and notifications for this profile.</p>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading activity...</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loading && !error ? (
        items.length > 0 ? (
          <div className="space-y-2">
            {items.slice(0, 30).map((item) => (
              <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.type}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleString("en-AU")}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        )
      ) : null}
    </div>
  );
}
