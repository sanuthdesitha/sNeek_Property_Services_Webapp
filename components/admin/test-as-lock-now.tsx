"use client";

import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";

/**
 * "Unlocked until 14:57" and "Lock now" (board "Test as"): ends the 15-minute
 * PIN unlock early. The list is rendered by the server only while unlocked,
 * so the page reloads into the PIN step.
 */
export function TestAsLockNow({ untilLabel }: { untilLabel: string }) {
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function lock() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/admin/test-as/unlock", { method: "DELETE" });
      if (!response.ok) throw new Error("not locked");
      window.location.assign("/v2/admin/system/test-as");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-surface-sunken))] px-2.5 py-1 text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">
        Unlocked until {untilLabel}
      </span>
      <EButton type="button" size="sm" variant="outline" onClick={lock} disabled={busy}>
        {busy ? "Locking…" : "Lock now"}
      </EButton>
      {failed ? <span role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">Could not lock. Try again.</span> : null}
    </div>
  );
}
