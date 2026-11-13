"use client";

import { useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { EEyebrow } from "@/components/v2/ui/primitives";
import { PHONE_SHEET_GRAB_CLASS } from "@/components/v2/ui/phone";

/** Below 640px the dialog is a bottom sheet (board "Admin phone"); unchanged from 640px up. */
const PHONE_SHEET = "max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 " +
  "max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:rounded-t-[18px] max-sm:px-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+1rem)] max-sm:pt-2";

export function JobDialog({ open, title, onClose, busy = false, children }: {
  open: boolean; title: string; onClose: () => void; busy?: boolean; children: ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="e-job-dialog-backdrop fixed inset-0 z-50 bg-black/50 motion-reduce:animate-none" />
      <Dialog.Content data-skin="estate" data-portal-accent="admin" aria-modal="true" aria-describedby={undefined} aria-busy={busy}
        className={`e-job-dialog fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-lg border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 text-[hsl(var(--e-foreground))] shadow-xl motion-reduce:animate-none ${PHONE_SHEET}`}
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <span aria-hidden className={PHONE_SHEET_GRAB_CLASS} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <EEyebrow className="mb-1">Jobs</EEyebrow>
            <Dialog.Title className="break-words text-xl font-semibold">{title}</Dialog.Title>
          </div>
          <Dialog.Close disabled={busy} aria-label="Close" title="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
            <X aria-hidden="true" className="h-4 w-4" />
          </Dialog.Close>
        </div>
        <div className="mt-4 min-w-0">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
