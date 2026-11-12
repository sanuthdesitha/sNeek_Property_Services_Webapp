"use client";

/**
 * Figure tiles that fold away on a phone (owner decision 2026-11-13).
 *
 * Below 640px the tiles start collapsed behind ONE summary row,
 * "10 figures · Show", a labelled disclosure button with `aria-expanded`
 * that opens the grid. From 640px up the button is hidden and the tiles are
 * always shown, laid out exactly as before: the one wrapper box takes the
 * place (and the parent's spacing) of the tiles' own container, so nothing
 * moves on desktop.
 *
 * The open/closed choice is remembered per `storageKey` for this browser tab
 * only (`sessionStorage`, every access in try/catch; nothing is stored when it
 * is unavailable). Used by every People tab, the client invoice figures, the
 * pay runs figures and the Quality hub stat cards.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "sneek:figures-open:";

function readOpen(storageKey: string): boolean | null {
  try {
    const value = window.sessionStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

function writeOpen(storageKey: string, open: boolean): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, open ? "1" : "0");
  } catch {
    // Storage unavailable (private window, blocked): the choice lasts until reload.
  }
}

export type CollapsibleFiguresProps = {
  /** Remembers the choice per tab or page, e.g. "people:clients". */
  storageKey: string;
  /** How many figures the tiles show ("5 figures"). */
  count: number;
  /** What the figures are, for the button's accessible name ("Client figures"). */
  label: string;
  children: React.ReactNode;
};

export function CollapsibleFigures({ storageKey, count, label, children }: CollapsibleFiguresProps) {
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();

  // A different tab or page starts from its own remembered choice.
  React.useEffect(() => {
    setOpen(readOpen(storageKey) ?? false);
  }, [storageKey]);

  function toggle() {
    setOpen((current) => {
      writeOpen(storageKey, !current);
      return !current;
    });
  }

  const noun = count === 1 ? "figure" : "figures";
  return (
    <div data-collapsible-figures="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={`${label}: ${count} ${noun}, ${open ? "hide" : "show"}`}
        onClick={toggle}
        data-figures-toggle=""
        className="flex min-h-11 w-full items-center justify-between rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-left text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] sm:hidden"
      >
        <span>
          <span className="e-tnum">{count}</span> {noun} · {open ? "Hide" : "Show"}
        </span>
        <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      <div id={regionId} data-figures-region="" className={open ? "mt-2 sm:mt-0" : "hidden sm:block"}>
        {children}
      </div>
    </div>
  );
}
