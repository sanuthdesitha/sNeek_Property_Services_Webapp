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
 */
import * as React from "react";
import { X } from "lucide-react";
import { EstatePortal } from "./portal-root";

export type EActionDialogProps = {
  open: boolean;
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons; rendered in a footer row. */
  footer?: React.ReactNode;
};

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hasAttribute("data-focus-skip"));
}

export function EActionDialog({ open, title, eyebrow, description, busy = false, onClose, children, footer }: EActionDialogProps) {
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
      const first = panel.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(panel)[0] ?? panel;
      first.focus();
    };
    timer = window.setTimeout(focusFirst, 0);
    return () => {
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
      <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
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
          className="relative z-10 my-8 w-full max-w-md rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-3)] focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-3.5">
            <div className="min-w-0">
              {eyebrow ? <p className="e-eyebrow mb-1">{eyebrow}</p> : null}
              <h2 id={titleId} className="text-[1rem] font-[650] [overflow-wrap:anywhere]">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] disabled:opacity-50"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4 text-[0.875rem]">
            {description ? <div id={descriptionId} className="text-[hsl(var(--e-text-secondary))]">{description}</div> : null}
            {children}
          </div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--e-border))] px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </EstatePortal>
  );
}
