"use client";

/**
 * Loading, failure and stale states for one Command section. A failed section
 * shows its own alert and Retry; the rest of the page is unaffected.
 */
import * as React from "react";
import type { SectionState } from "./use-command-section";

export function formatClock(at: Date | null, timeZone: string): string {
  if (!at) return "";
  return at.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
}

export function SectionLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={`Loading ${label}`} className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-8 animate-pulse rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]" />
      ))}
      <span className="sr-only">Loading {label}…</span>
    </div>
  );
}

export function SectionError({ label, message, onRetry }: { label: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-2 p-4 text-[0.8125rem]">
      <p>
        <span className="font-[600]">{label} could not be loaded.</span> {message}
      </p>
      <button type="button" onClick={onRetry} className="min-h-9 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 font-[500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
        Retry
      </button>
    </div>
  );
}

export function StaleNote({ state, timeZone }: { state: Pick<SectionState<unknown>, "stale" | "refreshedAt" | "reload" | "error">; timeZone: string }) {
  if (!state.stale) return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-warning-soft))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-warning))]">
      Could not refresh. Showing figures from {formatClock(state.refreshedAt, timeZone)}.
      <button type="button" onClick={state.reload} className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">Retry</button>
    </p>
  );
}

/** Renders the right state; `children` only receives data that was really read. */
export function SectionBody<T>({ state, label, timeZone, rows, children }: {
  state: SectionState<T>;
  label: string;
  timeZone: string;
  rows?: number;
  children: (data: T) => React.ReactNode;
}) {
  if (state.data === null) {
    if (state.status === "error") return <SectionError label={label} message={state.error} onRetry={state.reload} />;
    return <SectionLoading label={label} rows={rows} />;
  }
  return (
    <>
      <StaleNote state={state} timeZone={timeZone} />
      {children(state.data)}
    </>
  );
}
