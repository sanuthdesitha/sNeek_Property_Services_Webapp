"use client";

/**
 * A small confirm dialog for one office action (send a notice, pause a clock,
 * decline with a reason, raise an issue).
 *
 * - Labelled by its title and described by an optional summary.
 * - Focus moves into the dialog on open, Tab and Shift+Tab stay inside it,
 *   and on close focus returns to the control that opened it.
 * - Escape and the scrim close it, except while `busy`: a request in flight
 *   is never abandoned half way (the caller freezes its fields too).
 * - Rendered through EstatePortal so it keeps the Estate tokens (light and
 *   dark) even when opened from inside a side panel.
 * - Below 640px it is a bottom sheet (board "Admin phone") with the same
 *   semantics; from 640px up it is the centred card it always was.
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EstatePortal } from "./portal-root";
import { PHONE_SHEET_CONTAINER_CLASS, PHONE_SHEET_GRAB_CLASS, PHONE_SHEET_PANEL_CLASS } from "./phone";

export type EActionDialogProps = {
  open: boolean;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons; rendered in a footer row. */
  footer?: React.ReactNode;
  /** Replaces the footer row's layout classes (the confirm dialog stacks its buttons on a phone). */
  footerClassName?: string;
  /** A wider panel from 640px up, for a read-only preview (photos, a rendered record). Phones keep the sheet. */
  wide?: boolean;
};

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hasAttribute("data-focus-skip"));
}

/** Where focus starts: a marked control, else the first control after the close button. */
function initialFocus(root: HTMLElement): HTMLElement {
  const marked = root.querySelector<HTMLElement>("[data-autofocus]");
  if (marked) return marked;
  const items = focusables(root);
  return items.find((element) => !element.hasAttribute("data-dialog-close")) ?? items[0] ?? root;
}

export function EActionDialog({ open, title, eyebrow, description, busy = false, onClose, children, footer, footerClassName, wide = false }: EActionDialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const busyRef = React.useRef(busy);
  busyRef.current = busy;
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The portal mounts one render later, so wait for the panel to exist.
    let attempts = 0;
    let timer = 0;
    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) {
        if (attempts++ < 10) timer = window.setTimeout(focusFirst, 16);
        return;
      }
      initialFocus(panel).focus();
    };
    timer = window.setTimeout(focusFirst, 0);
    // A menu that opened this dialog may hand focus back to its trigger after
    // the dialog took it; keep focus inside while open (a real trap), and let
    // Escape close from anywhere on the page.
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      const target = event.target as Node | null;
      if (!panel || !target || panel.contains(target)) return;
      if (target instanceof Element && target.closest('[role="dialog"]')) return;
      // A menu or popover opened from inside the dialog is portalled after it: allowed.
      if (panel.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) return;
      initialFocus(panel).focus();
    };
    const onDocumentKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      if (!busyRef.current) closeRef.current();
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onDocumentKey);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onDocumentKey);
      window.clearTimeout(timer);
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target && document.contains(target)) target.focus();
    };
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busyRef.current) closeRef.current();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = focusables(panelRef.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;
  return (
    <EstatePortal accent="admin">
      <div className={cn("fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 sm:items-center", PHONE_SHEET_CONTAINER_CLASS)}>
        <div aria-hidden className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)]" onClick={() => (busy ? undefined : onClose())} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          aria-busy={busy}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn("relative z-10 my-8 w-full rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-3)] focus:outline-none", wide ? "max-w-4xl" : "max-w-md", PHONE_SHEET_PANEL_CLASS)}
        >
          <span aria-hidden className={PHONE_SHEET_GRAB_CLASS} />
          <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-3.5">
            <div className="min-w-0">
              {eyebrow ? <p className="e-eyebrow mb-1">{eyebrow}</p> : null}
              <h2 id={titleId} className="text-[1rem] font-[650] [overflow-wrap:anywhere]">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              data-dialog-close
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full max-sm:h-11 max-sm:w-11 border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] disabled:opacity-50"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4 text-[0.875rem] max-sm:max-h-none max-sm:overflow-visible">
            {description ? <div id={descriptionId} className="text-[hsl(var(--e-text-secondary))]">{description}</div> : null}
            {children}
          </div>
          {footer ? <div className={cn("border-t border-[hsl(var(--e-border))] px-5 py-3 max-sm:sticky max-sm:bottom-0 max-sm:bg-[hsl(var(--e-surface))]", footerClassName ?? "flex flex-wrap justify-end gap-2 max-sm:[&>*]:flex-1")}>{footer}</div> : null}
        </div>
      </div>
    </EstatePortal>
  );
}
