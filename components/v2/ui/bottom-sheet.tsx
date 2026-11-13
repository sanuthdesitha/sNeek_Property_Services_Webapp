"use client";

/**
 * ESTATE bottom sheet: a labelled modal panel that rises from the bottom of a
 * phone screen (board "Admin phone", 2026-11). Used by the filter sheet, the
 * bulk bar's "More", the admin More menu and any phone-only chooser.
 *
 * Radix Dialog supplies the semantics: labelled by its title, focus moves in
 * on open and stays inside, Escape and the scrim close it (except while
 * `busy`), and focus returns to the opener on close. It renders through
 * EstatePortal so it keeps the Estate tokens in light and dark.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EstatePortal } from "./portal-root";
import { PHONE_SHEET_GRAB_CLASS } from "./phone";

export type EBottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible title and accessible name. */
  title: React.ReactNode;
  /** One line under the title; also the accessible description. */
  description?: React.ReactNode;
  /** Controls beside the title (e.g. "Clear filters"). */
  headerAction?: React.ReactNode;
  /** Sticky footer, e.g. the apply button. */
  footer?: React.ReactNode;
  /** A request is in flight: the sheet cannot be dismissed. */
  busy?: boolean;
  /** Fill the screen height (the admin More menu). */
  tall?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function EBottomSheet({ open, onOpenChange, title, description, headerAction, footer, busy = false, tall = false, children, className }: EBottomSheetProps) {
  const opener = React.useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (next || !busy) onOpenChange(next); }}>
      {open ? (
        <EstatePortal>
          <Dialog.Overlay className="fixed inset-0 z-[65] bg-[hsl(160_18%_8%/0.45)]" />
          <Dialog.Content
            {...(description ? {} : { "aria-describedby": undefined })}
            aria-busy={busy || undefined}
            onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (opener.current?.isConnected) opener.current.focus();
            }}
            onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
            onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
            data-bottom-sheet=""
            className={cn(
              "fixed inset-x-0 bottom-0 z-[70] flex max-h-[92dvh] flex-col rounded-t-[18px] border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-3)] focus:outline-none",
              "sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-1/2 sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--e-radius-lg)] sm:border",
              tall && "max-sm:top-[calc(env(safe-area-inset-top)+0.5rem)]",
              className,
            )}
          >
            <span aria-hidden className={PHONE_SHEET_GRAB_CLASS} />
            <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-2 sm:pt-4">
              <div className="min-w-0">
                <Dialog.Title className="text-[1rem] font-[650] [overflow-wrap:anywhere]">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{description}</Dialog.Description> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {headerAction}
                <Dialog.Close
                  disabled={busy}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-50"
                >
                  <X aria-hidden className="h-4 w-4" />
                </Dialog.Close>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
            {footer ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{footer}</div>
            ) : null}
          </Dialog.Content>
        </EstatePortal>
      ) : null}
    </Dialog.Root>
  );
}
