"use client";

/**
 * PhoneStackedTable (board "Admin phone", 2026-11): on a phone only, lays the
 * plain `<table>` inside it (an `ETableShell` or a hand-written table) out as
 * stacked cards: the header row is hidden, each row becomes a card whose
 * first cell is the title and whose other cells sit in pairs under their
 * column's header text, so nothing scrolls sideways.
 *
 * From 640px up, and on the first paint everywhere, it renders its children
 * exactly as given, without a wrapper, so desktop markup does not change.
 * Only wrap stateless table markup: the table remounts once when the phone
 * layout takes over.
 *
 * The header text is copied onto each cell as `data-label` (read by the
 * `before:` label) and kept up to date as rows are added; the table's own
 * semantics (thead, th scope, captions) are untouched.
 */
import * as React from "react";
import { useIsPhone } from "@/components/v2/ui/use-phone";

/** The card layout; only ever applied below 640px (the wrapper exists only on a phone). */
export const PHONE_STACKED_TABLE_CLASS = [
  "min-w-0",
  "[&_table]:!min-w-0 [&_table]:block [&_thead]:hidden [&_tbody]:block",
  "[&_tbody>tr]:flex [&_tbody>tr]:flex-wrap [&_tbody>tr]:items-start [&_tbody>tr]:gap-x-3 [&_tbody>tr]:gap-y-2 [&_tbody>tr]:px-3.5 [&_tbody>tr]:py-3",
  "[&_tbody>tr>td]:block [&_tbody>tr>td]:min-w-0 [&_tbody>tr>td]:!p-0 [&_tbody>tr>td]:!text-left [&_tbody>tr>td]:basis-[calc(50%-0.375rem)] [&_tbody>tr>td]:grow",
  "[&_tbody>tr>td:first-child]:basis-full [&_tbody>tr>td:first-child]:font-[600]",
  "[&_tbody>tr>td[colspan]]:basis-full",
  "[&_tbody>tr>td]:before:block [&_tbody>tr>td]:before:text-[0.6875rem] [&_tbody>tr>td]:before:font-semibold [&_tbody>tr>td]:before:text-[hsl(var(--e-muted-foreground))] [&_tbody>tr>td]:before:content-[attr(data-label)]",
  "[&_tbody>tr>td:first-child]:before:hidden [&_tbody>tr>td:last-child:not(:first-child)]:basis-full",
].join(" ");

/** Copies each column's header text onto its body cells as `data-label`. */
export function labelTableCells(root: HTMLElement): void {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    const headers = Array.from(table.querySelectorAll("thead tr:first-child > th")).map((th) => (th.textContent ?? "").trim());
    for (const row of Array.from(table.querySelectorAll("tbody > tr"))) {
      Array.from(row.children).forEach((cell, index) => {
        const label = headers[index];
        if (label && cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
      });
    }
  }
}

export function PhoneStackedTable({ children }: { children: React.ReactNode }) {
  const phone = useIsPhone();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = ref.current;
    if (!phone || !root) return;
    labelTableCells(root);
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => labelTableCells(root));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [phone]);

  if (!phone) return <>{children}</>;
  return (
    <div ref={ref} data-phone-stacked-table="" className={PHONE_STACKED_TABLE_CLASS}>
      {children}
    </div>
  );
}
