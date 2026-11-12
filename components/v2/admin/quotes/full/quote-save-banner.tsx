"use client";

/**
 * The quote page's save banners (owner decision 2026-11-13, the invoice
 * editor's design): the conflict banner ("Reload theirs" / "Keep my edits and
 * retry") when the server refused a stale write, the failed-save banner with
 * Retry, and the note on a quote the client can already open online.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import type { QuoteSaveStatus } from "@/lib/quotes/quote-autosave";

/** The current time, refreshed every few seconds while `active` ("Saved 10 seconds ago"). */
export function useQuoteNow(active: boolean, intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export type QuoteSaveBannerProps = {
  status: QuoteSaveStatus;
  onReloadTheirs: () => void;
  onKeepMine: () => void;
  onDismiss: () => void;
};

export function QuoteSaveBanner({ status, onReloadTheirs, onKeepMine, onDismiss }: QuoteSaveBannerProps) {
  if (status.kind === "conflict") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.5)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-warning))]">
        <span className="min-w-0 flex-1 break-words">
          <strong className="font-[600]">{status.what}: not saved.</strong> {status.message} Your edits are still here.
        </span>
        <EButton type="button" size="sm" variant="outline" onClick={onReloadTheirs}>
          Reload theirs
        </EButton>
        <EButton type="button" size="sm" variant="outline" onClick={onKeepMine}>
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

/** A shared quote: the client's online page reads the stored quote, so each save shows there at once. */
export function LiveForClientNote() {
  return (
    <p role="note" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
      <strong className="font-[600]">The client can already open this quote online.</strong> Changes save on their own a moment after you stop typing, and the client&apos;s online quote shows each saved change straight away. Nothing is emailed until you choose Resend.
    </p>
  );
}
