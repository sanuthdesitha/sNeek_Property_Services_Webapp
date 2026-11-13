"use client";

/**
 * PhoneActionSheet (board "Admin phone", 2026-11): a page's "More" menu as a
 * bottom sheet on a phone. It takes the very same `ERowMenuItem` list the
 * desktop `ERowMenu` shows, so every desktop action stays reachable with the
 * same labels, group headings, disabled reasons and badges. Items only START
 * an action: confirmation, PIN and typed-phrase rules stay in the dialog each
 * action already opens.
 *
 * Phone-only: render it from a phone branch (or keep it closed on desktop).
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";
import { PHONE_QUERY } from "@/components/v2/ui/phone";

export type PhoneActionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: ERowMenuItem[];
  /** Plain note at the foot (e.g. which actions ask for a PIN). */
  footnote?: string;
  /** Extra content above the items (e.g. status actions that are components). */
  lead?: React.ReactNode;
};

const ITEM_CLASS =
  "flex min-h-11 w-full items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] px-1 py-2 text-left text-[0.875rem] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:cursor-not-allowed disabled:opacity-60";

function ItemBody({ item }: { item: ERowMenuItem }) {
  const note = item.disabled ? item.hint : item.badge;
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {item.icon}
        <span className="[overflow-wrap:anywhere]">{item.label}</span>
      </span>
      {note ? <span className="max-w-[55%] shrink-0 text-right text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{note}</span> : null}
    </>
  );
}

export function PhoneActionSheet({ open, onOpenChange, title, items, footnote, lead }: PhoneActionSheetProps) {
  function run(item: ERowMenuItem) {
    onOpenChange(false);
    item.onSelect?.();
  }
  return (
    <EBottomSheet open={open} onOpenChange={onOpenChange} title={title} tall={items.length > 9}>
      {lead ? <div className="mb-2 flex flex-col gap-2">{lead}</div> : null}
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.key}>
            {item.heading ? (
              <p className={cn("e-eyebrow pb-1 pt-3", item.danger && "text-[hsl(var(--e-danger))]")}>{item.heading}</p>
            ) : null}
            {item.href && !item.disabled ? (
              <Link
                href={item.href}
                target={item.newTab ? "_blank" : undefined}
                rel={item.newTab ? "noreferrer" : undefined}
                onClick={() => onOpenChange(false)}
                className={cn(ITEM_CLASS, item.danger && "text-[hsl(var(--e-danger))]")}
              >
                <ItemBody item={item} />
              </Link>
            ) : (
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => run(item)}
                className={cn(ITEM_CLASS, item.danger && "text-[hsl(var(--e-danger))]")}
              >
                <ItemBody item={item} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {footnote ? <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{footnote}</p> : null}
    </EBottomSheet>
  );
}

/** True when the viewport is a phone right now (client only; false on the server). */
export function isPhoneNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return Boolean(window.matchMedia(PHONE_QUERY).matches);
}
