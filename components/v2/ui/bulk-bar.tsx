"use client";

/**
 * ESTATE bulk bar: appears while rows are selected, states how many, offers
 * the bulk actions and a clear. The actions themselves run through one server
 * endpoint that reports a result per row; this bar only starts them.
 *
 * Phones (below 640px, board "Admin phone"): the bar docks at the bottom of
 * the screen above the tab bar. It shows the count, the first `phoneActions`
 * actions (default two), "More" and Clear; More opens the rest inside the
 * bar. Every action stays mounted in one place at every width, so an action
 * that owns its own dialog (e.g. an export preview) keeps working, and from
 * 640px up the bar is laid out exactly as before.
 */
import * as React from "react";
import { ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHONE_DOCK_CLASS } from "./phone";

export type EBulkBarProps = {
  count: number;
  /** e.g. "invoice" → "3 invoices selected". */
  noun: { one: string; many: string };
  onClear: () => void;
  /** Action buttons (EBulkButton), most used first. */
  children: React.ReactNode;
  /** Locks the bar while a bulk action runs. */
  busy?: boolean;
  /** Extra line, e.g. that selection only spans this filter set. */
  note?: React.ReactNode;
  /** Shown after the count, e.g. the selected total. */
  summary?: React.ReactNode;
  /** How many actions a phone shows before "More". Default 2. */
  phoneActions?: number;
  className?: string;
};

export function EBulkBar({ count, noun, onClear, children, busy = false, note, summary, phoneActions = 2, className }: EBulkBarProps) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreId = React.useId();
  const actions = React.Children.toArray(children).filter(React.isValidElement);
  const hasMore = actions.length > phoneActions;
  React.useEffect(() => {
    if (count <= 0) setMoreOpen(false);
  }, [count]);
  if (count <= 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      data-bulk-bar=""
      className={cn(
        // The concept's `.bulk`: the sidebar's dark surface, light text.
        "flex flex-wrap items-center gap-2.5 rounded-[10px] bg-[hsl(var(--e-sidebar-bg))] py-2 pl-3.5 pr-2.5 text-[hsl(var(--e-sidebar-active-bg))]",
        className,
        // Phones: docked above the tab bar, regardless of the page's placement.
        PHONE_DOCK_CLASS,
        "max-sm:gap-2 max-sm:rounded-[14px] max-sm:p-2.5 max-sm:shadow-[var(--e-elevation-3)]",
      )}
    >
      <div className="min-w-0 max-sm:w-full">
        <p className="text-[0.8125rem] font-[600]" aria-live="polite">
          {count} {count === 1 ? noun.one : noun.many} selected{summary ? <> · <span className="e-tnum">{summary}</span></> : null}
        </p>
        {note ? <p className="text-[0.75rem] text-[hsl(var(--e-sidebar-fg))]">{note}</p> : null}
      </div>
      <span className="min-w-0 flex-1 max-sm:hidden" />
      <fieldset disabled={busy} className="flex min-w-0 flex-wrap items-center gap-2 max-sm:grid max-sm:w-full max-sm:grid-cols-2">
        {actions.map((action, index) => (
          <div
            key={action.key ?? index}
            data-bulk-action=""
            id={index === phoneActions ? moreId : undefined}
            className={cn("sm:contents max-sm:min-w-0 max-sm:[&>*]:w-full", index >= phoneActions && !moreOpen && "max-sm:hidden")}
          >
            {action}
          </div>
        ))}
        {hasMore ? (
          <EBulkButton
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen((current) => !current)}
            className="sm:hidden"
          >
            {moreOpen ? "Fewer" : "More"} <ChevronUp aria-hidden className={cn("h-3.5 w-3.5 transition-transform", !moreOpen && "rotate-180")} />
          </EBulkButton>
        ) : null}
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
        "max-sm:h-11 max-sm:justify-center max-sm:text-[0.8125rem]",
        className,
      )}
      {...props}
    />
  );
}
