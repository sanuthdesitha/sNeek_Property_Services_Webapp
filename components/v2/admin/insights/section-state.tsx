"use client";

/**
 * Loading, failure and stale states for one Insights section. A failed
 * section shows its own message; the rest of the page stays usable.
 */
import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

export function SectionState({
  loading = false,
  error = null,
  stale = false,
  onRetry,
  label,
}: {
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  onRetry?: () => void;
  label: string;
}) {
  if (stale && error) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
        <span>Showing the last loaded {label}. {error}</span>
        {onRetry ? (
          <EButton size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Try again
          </EButton>
        ) : null}
      </div>
    );
  }
  if (loading || !error) {
    return (
      <p role="status" className="flex items-center justify-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] py-12 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading {label}…
      </p>
    );
  }
  return (
    <div role="alert" className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-10 text-center">
      <p className="e-display-sm">Could not load the {label}</p>
      <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{error}</p>
      {onRetry ? (
        <EButton size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Try again
        </EButton>
      ) : null}
    </div>
  );
}
