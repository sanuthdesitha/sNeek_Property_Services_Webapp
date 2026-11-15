"use client";

import "@/app/v2/estate.css";
import * as React from "react";
import { X } from "lucide-react";

/** One end-of-session record per page load, even under React's double effects. */
let recorded = false;

/**
 * "Your test as Marco Rossi ended after one hour." (board "Test as"). Shown on
 * the first page load after the hour ran out. It records the end (and, after
 * full access, queues the person's inbox note) by calling the existing stop
 * endpoint, which also clears the marker so the note is not shown again.
 */
export function TestAsEndedNote({ targetName }: { targetName: string }) {
  const [open, setOpen] = React.useState(true);

  React.useEffect(() => {
    if (recorded) return;
    recorded = true;
    void fetch("/api/admin/impersonate", { method: "DELETE" }).catch(() => undefined);
  }, []);

  if (!open) return null;
  return (
    <div data-skin="estate" className="pointer-events-none fixed inset-x-0 bottom-4 z-[210] flex justify-center !bg-transparent px-4 max-sm:bottom-20">
      <div
        role="status"
        className="pointer-events-auto flex max-w-[36rem] items-center gap-3 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-sidebar-bg))] px-4 py-2.5 text-[0.875rem] text-[hsl(var(--e-sidebar-fg))] shadow-lg"
      >
        <span className="min-w-0">Your test as {targetName} ended after one hour.</span>
        <a href="/v2/admin/system/test-as" className="shrink-0 font-[600] underline underline-offset-2">Test as</a>
        <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full sm:h-8 sm:w-8">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
