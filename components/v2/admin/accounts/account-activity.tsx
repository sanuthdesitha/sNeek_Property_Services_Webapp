"use client";

/**
 * ESTATE account activity log — v2-native replacement for
 * components/admin/profile-activity-log.tsx. Same GET /api/admin/users/:id/activity
 * ({ items: [{ id, type, title, body, createdAt }] }).
 */
import { useEffect, useState } from "react";
import { EBadge, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";

type ActivityItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
};

export function AccountActivity({ userId }: { userId: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${userId}/activity`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">Account activity</ECardTitle>
      </ECardHeader>
      <ECardBody className="pt-0">
        {items === null ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading activity…</p>
        ) : items.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No recorded activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 border-b border-[hsl(var(--e-border)/0.7)] pb-3 last:border-b-0 last:pb-0"
              >
                <EBadge tone={item.type === "NOTIFICATION" ? "info" : "neutral"} soft>
                  {item.type === "NOTIFICATION" ? "Notice" : "Audit"}
                </EBadge>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-[550]">{item.title}</p>
                  {item.body ? (
                    <p className="mt-0.5 line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.body}</p>
                  ) : null}
                  <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    {new Date(item.createdAt).toLocaleString("en-AU")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ECardBody>
    </ECard>
  );
}
