"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import {
  forwardRef,
  HTMLAttributes,
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = createContext<DialogContextValue>({
  open: false,
  setOpen: () => {},
});

export function useDialog() {
  return useContext(DialogContext);
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const setOpen = useCallback(
    (value: boolean) => onOpenChange(value),
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, setOpen]);

  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center"
              role="dialog"
              aria-modal="true"
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </DialogContext.Provider>
  );
}

export function DialogOverlay({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = useDialog();
  return (
    <div
      className={cn(
        "fixed inset-0 z-40 bg-black/50 animate-fade-in",
        className,
      )}
      onClick={() => setOpen(false)}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = useDialog();

  return (
    <>
      <DialogOverlay />
      <div
        className={cn(
          "relative z-50 w-full max-w-lg mx-4 bg-surface-elevated rounded-xl shadow-xl animate-scale-in",
          className,
        )}
        {...props}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 p-6 pb-4", className)} {...props} />
  );
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-lg font-semibold text-text-primary", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-text-secondary", className)} {...props} />
  );
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2 p-6 pt-4",
        className,
      )}
      {...props}
    />
  );
}
