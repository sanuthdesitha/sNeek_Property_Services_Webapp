"use client";

/**
 * Right-hand drawer used by the builder (Versions, Test as cleaner, Form
 * settings, Checks). A modal dialog: focus moves to its title when it opens,
 * Tab stays inside, Escape or the backdrop closes it and focus returns to the
 * element that opened it. Full width on a phone.
 */
import * as React from "react";
import { X } from "lucide-react";
import { EEyebrow } from "@/components/v2/ui/primitives";
import { EstatePortal } from "@/components/v2/ui/portal-root";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BuilderDrawer({
  open,
  onClose,
  eyebrow,
  title,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) opener.current = active;
    titleRef.current?.focus();
    return () => {
      const target = opener.current;
      window.setTimeout(() => target?.isConnected && target.focus(), 0);
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <EstatePortal>
      <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)] backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
        <div
          ref={panelRef}
          className={cn(
            "relative z-10 flex h-full w-full flex-col border-l border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)]",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-4">
            <div className="min-w-0">
              {eyebrow ? <EEyebrow className="mb-0.5">{eyebrow}</EEyebrow> : null}
              <h2 id={titleId} ref={titleRef} tabIndex={-1} className="e-display-sm break-words outline-none">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </div>
      </div>
    </EstatePortal>
  );
}
