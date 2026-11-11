"use client";

/**
 * ESTATE bulk bar: appears while rows are selected, states how many, offers
 * the bulk actions and a clear. The actions themselves run through one server
 * endpoint that reports a result per row; this bar only starts them.
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

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
  /** Shown after the count, e.g. the selected total. */
  summary?: React.ReactNode;
  className?: string;
};

export function EBulkBar({ count, noun, onClear, children, busy = false, note, summary, className }: EBulkBarProps) {
  if (count <= 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        // The concept's `.bulk`: the sidebar's dark surface, light text.
        "flex flex-wrap items-center gap-2.5 rounded-[10px] bg-[hsl(var(--e-sidebar-bg))] py-2 pl-3.5 pr-2.5 text-[hsl(var(--e-sidebar-active-bg))]",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-[600]" aria-live="polite">
          {count} {count === 1 ? noun.one : noun.many} selected{summary ? <> · <span className="e-tnum">{summary}</span></> : null}
        </p>
        {note ? <p className="text-[0.75rem] text-[hsl(var(--e-sidebar-fg))]">{note}</p> : null}
      </div>
      <span className="min-w-0 flex-1" />
      <fieldset disabled={busy} className="flex min-w-0 flex-wrap items-center gap-2">
        {children}
        <EBulkButton onClick={onClear}>
          <X aria-hidden className="h-3.5 w-3.5" /> Clear
        </EBulkButton>
      </fieldset>
    </div>
  );
}

/** A button styled for the dark bulk bar (`.bulk .btn`). */
export function EBulkButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] border border-[hsl(var(--e-sidebar-hairline))] bg-transparent px-2.5",
        "text-[0.75rem] font-[500] text-[hsl(var(--e-sidebar-active-bg))] hover:bg-[hsl(var(--e-sidebar-hairline))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-sidebar-active-bg))] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
