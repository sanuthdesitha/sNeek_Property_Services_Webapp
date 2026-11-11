"use client";

/**
 * ESTATE bulk bar: appears while rows are selected, states how many, offers
 * the bulk actions and a clear. The actions themselves run through one server
 * endpoint that reports a result per row; this bar only starts them.
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "./primitives";

export type EBulkBarProps = {
  count: number;
  /** e.g. "invoice" → "3 invoices selected". */
  noun: { one: string; many: string };
  onClear: () => void;
  /** Action buttons (EButton). */
  children: React.ReactNode;
  /** Locks the bar while a bulk action runs. */
  busy?: boolean;
  /** Extra line, e.g. that selection only spans this filter set. */
  note?: React.ReactNode;
  className?: string;
};

export function EBulkBar({ count, noun, onClear, children, busy = false, note, className }: EBulkBarProps) {
  if (count <= 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-gold)/0.5)]",
        "bg-[hsl(var(--e-gold-soft))] px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]" aria-live="polite">
          {count} {count === 1 ? noun.one : noun.many} selected
        </p>
        {note ? <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{note}</p> : null}
      </div>
      <fieldset disabled={busy} className="flex min-w-0 flex-wrap items-center gap-2">
        {children}
        <EButton size="sm" variant="ghost" onClick={onClear}>
          <X aria-hidden className="h-3.5 w-3.5" /> Clear selection
        </EButton>
      </fieldset>
    </div>
  );
}
