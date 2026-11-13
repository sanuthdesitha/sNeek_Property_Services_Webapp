"use client";

/**
 * ESTATE side panel: a peek of one record beside a list (the concept's
 * `.panel`). On wide screens it sits to the right of the list and the list
 * stays usable; below `lg` it becomes a full-height sheet over the page.
 *
 * - It is a labelled region (`label`, described by its title) and, as a sheet, a
 *   modal dialog whose Tab order stays inside it.
 * - When it opens, focus moves to the title; Escape closes it and focus returns
 *   to the element that opened it (or `returnFocusTo`).
 * - The caller owns what is shown: pass the record's content as children and
 *   keep the record id in the URL so a reload reopens the same record.
 * - Phones (below 640px, board "Admin phone"): a full-screen sheet with a back
 *   arrow on the left, its own scroll and the page behind it locked; closing
 *   restores the page's scroll position as well as focus.
 */
import * as React from "react";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsPhone } from "./use-phone";

export type ESidePanelProps = {
  open: boolean;
  /** Visible title; also the panel's accessible name. */
  title: React.ReactNode;
  /** Accessible label for the whole panel, e.g. "Job preview". */
  label: string;
  onClose: () => void;
  /** Content above the title (status pill, primary link). */
  toolbar?: React.ReactNode;
  /** Line under the title (time, type, number). */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Element to focus after closing when the opener is gone. */
  returnFocusTo?: () => HTMLElement | null;
  className?: string;
};

const SHEET_QUERY = "(max-width: 1023.98px)";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useIsSheet(): boolean {
  const [sheet, setSheet] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SHEET_QUERY);
    const update = () => setSheet(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return sheet;
}

export function ESidePanel({ open, title, label, onClose, toolbar, subtitle, children, returnFocusTo, className }: ESidePanelProps) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const sheet = useIsSheet();
  const phone = useIsPhone();
  const pageScroll = React.useRef<number | null>(null);

  // Phones: lock the page behind the full-screen sheet and remember where the
  // list was scrolled to, so closing returns to the same place.
  React.useEffect(() => {
    if (!open || !phone) return;
    pageScroll.current = window.scrollY;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      const top = pageScroll.current;
      pageScroll.current = null;
      if (top !== null) window.setTimeout(() => { if (window.scrollY !== top) window.scrollTo({ top }); }, 0);
    };
  }, [open, phone]);

  // Remember the opener and move focus into the panel each time it opens.
  React.useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panelRef.current?.contains(active)) opener.current = active;
    titleRef.current?.focus();
  }, [open]);

  const close = React.useCallback(() => {
    onClose();
    const target = opener.current?.isConnected ? opener.current : returnFocusTo?.() ?? null;
    // After the panel unmounts, so focus is not dropped onto the body.
    window.setTimeout(() => target?.focus(), 0);
  }, [onClose, returnFocusTo]);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !sheet || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null || item === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;
  return (
    <aside
      ref={panelRef}
      aria-label={label}
      aria-describedby={titleId}
      role={sheet ? "dialog" : "complementary"}
      aria-modal={sheet ? true : undefined}
      onKeyDown={onKeyDown}
      data-side-panel=""
      className={cn(
        // Sheet below lg; a sticky column beside the list from lg.
        "fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto overscroll-contain bg-[hsl(var(--e-surface))] px-5 py-[18px] text-[hsl(var(--e-foreground))]",
        "max-sm:px-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+1rem)] max-sm:pt-3",
        "lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:w-[400px] lg:shrink-0 lg:rounded-[12px] lg:border lg:border-[hsl(var(--e-border))]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>
        <button
          type="button"
          onClick={close}
          aria-label={`Close ${label.toLowerCase()}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--e-radius)] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] max-sm:order-first max-sm:h-11 max-sm:w-11 max-sm:border max-sm:border-[hsl(var(--e-border))]"
        >
          {/* Phones read it as "back to the list"; the accessible name is the same. */}
          <ArrowLeft aria-hidden className="h-5 w-5 sm:hidden" />
          <X aria-hidden className="h-4 w-4 max-sm:hidden" />
        </button>
      </div>
      <div className="min-w-0">
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="e-serif break-words text-[1.375rem] leading-tight focus:outline-none">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{subtitle}</p> : null}
      </div>
      {children}
    </aside>
  );
}
