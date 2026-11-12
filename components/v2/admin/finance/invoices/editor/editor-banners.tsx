"use client";

/**
 * The editor's save state: the words beside the subtitle ("Saving…", "Saved
 * 10 seconds ago", "Unsaved changes", …), the failed-save banner with Retry,
 * and the conflict banner ("Reload theirs" / "Keep my edits and retry") shown
 * when the server refused a stale write (Wave D).
 */
import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import type { SaveStatus } from "./use-invoice-editor";

/** "just now", "10 seconds ago", "3 minutes ago". */
export function agoText(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

/** The words beside the subtitle: saving, failed, conflict, unsaved, or when it was last saved. */
export function saveStateLabel(
  status: SaveStatus,
  unsaved: boolean,
  updatedAt: string,
  timezone: string,
  saved?: { at: number | null; now: number },
): string {
  if (status.kind === "saving") return "Saving…";
  if (status.kind === "failed") return "Not saved";
  if (status.kind === "conflict") return "Not saved: changed elsewhere";
  if (unsaved) return "Unsaved changes";
  if (saved?.at) return `Saved ${agoText(saved.at, saved.now)}`;
  try {
    return `Last changed ${formatInTimeZone(new Date(updatedAt), timezone, "d MMM, HH:mm")}`;
  } catch {
    return "Saved";
  }
}

/** The current time, refreshed every few seconds while `active`. */
export function useNow(active: boolean, intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export function StatusBanner({ status, onDismiss, onReloadTheirs }: { status: SaveStatus; onDismiss: () => void; onReloadTheirs: () => void }) {
  if (status.kind === "conflict") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.5)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-warning))]">
        <span className="min-w-0 flex-1 break-words">
          <strong className="font-[600]">{status.what}: not saved.</strong> {status.message} Your edits are still here.
        </span>
        <EButton type="button" size="sm" variant="outline" onClick={onReloadTheirs}>
          Reload theirs
        </EButton>
        <EButton type="button" size="sm" variant="outline" onClick={status.keepMine}>
          Keep my edits and retry
        </EButton>
      </div>
    );
  }
  if (status.kind !== "failed") return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.5)] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
      <span className="min-w-0 flex-1 break-words">
        <strong className="font-[600]">{status.what}: not saved.</strong> {status.message}
      </span>
      {status.retry ? (
        <EButton type="button" size="sm" variant="outline" onClick={status.retry}>
          Retry
        </EButton>
      ) : null}
      <EButton type="button" size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </EButton>
    </div>
  );
}
