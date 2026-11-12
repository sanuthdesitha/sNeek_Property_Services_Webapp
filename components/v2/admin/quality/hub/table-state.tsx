"use client";

/**
 * Loading / failure / empty / stale wrapper for the hub's tables, with the
 * same rules as EDataTable: no rows + loading is a status, no rows + error is
 * an alert with retry, rows + error is a stale banner over the last good rows.
 */
import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

export function TableState({
  loading,
  error,
  hasRows,
  hasData,
  onRetry,
  emptyTitle,
  emptyDescription,
  children,
}: {
  loading: boolean;
  error: string | null;
  hasRows: boolean;
  /** A read for the current scope has completed. */
  hasData: boolean;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  children: React.ReactNode;
}) {
  const retry = (
    <EButton size="sm" variant="outline" onClick={onRetry}>
      <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Try again
    </EButton>
  );
  if (!hasRows && loading) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 px-6 py-14 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!hasRows && error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="e-display-sm">Could not load this list</p>
        <p className="max-w-md text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{error}</p>
        {retry}
      </div>
    );
  }
  if (!hasRows && hasData) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="e-display-sm">{emptyTitle}</p>
        {emptyDescription ? <p className="max-w-md text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{emptyDescription}</p> : null}
      </div>
    );
  }
  if (!hasRows) return null;
  return (
    <>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-warning-soft))] px-4 py-2 text-[0.8125rem]">
          <span>Showing the last loaded list. {error}</span>
          {retry}
        </div>
      ) : null}
      {children}
    </>
  );
}
