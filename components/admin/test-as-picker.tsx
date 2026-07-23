"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

export type TestAsCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
};

/**
 * One row per user, with the read-only / full-access choice made at the moment
 * of entry rather than as a hidden global setting — the mode is the single most
 * consequential thing about a test session, so it is chosen deliberately every
 * time and defaults to the safe option.
 */
export function TestAsPicker({ users }: { users: TestAsCandidate[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(userId: string, mode: "READ_ONLY" | "FULL") {
    setPendingId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, mode }),
      });
      const data = (await res.json().catch(() => ({}))) as { home?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not start the test session.");
        setPendingId(null);
        return;
      }
      // Full page load, not router.push: the identity change has to be picked
      // up by every server component, and the Router Cache would otherwise
      // serve the admin's own already-rendered pages.
      window.location.href = data.home ?? "/v2";
    } catch {
      setError("Could not start the test session.");
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
      ) : null}
      <div className="divide-y divide-[hsl(var(--e-border))]">
        {users.map((u) => {
          const busy = pendingId === u.id;
          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.875rem] font-medium">{u.name || "Unnamed"}</p>
                <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {u.email}
                </p>
              </div>
              <EButton
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => start(u.id, "READ_ONLY")}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                View only
              </EButton>
              <EButton
                size="sm"
                variant="outline-gold"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Full test access as ${u.name || u.email}.\n\nAnything you do will be saved for real, under their name — clock-ins, form submissions, messages. Continue?`,
                    )
                  ) {
                    start(u.id, "FULL");
                  }
                }}
              >
                Full access
              </EButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
