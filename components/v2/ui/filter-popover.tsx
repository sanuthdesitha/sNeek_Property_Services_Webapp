"use client";

/**
 * ESTATE filter popover: a chip that opens a small panel holding one filter's
 * controls (client, period, Xero state …). The chip names the filter and shows
 * its current value, so active filters stay visible while the panel is closed.
 * Escape closes the panel and returns focus to the chip.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "./filter-chips";

export type EFilterPopoverProps = {
  label: string;
  /** Current value in words; when set the chip reads "Label: value" and looks active. */
  value?: string | null;
  /** Shown as "Label: emptyValue" (not active) when no value is set, e.g. "Client: all". */
  emptyValue?: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function EFilterPopover({ label, value, emptyValue, disabled = false, children, className }: EFilterPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(E_CHIP_CLASS, value && E_CHIP_ON_CLASS, "max-w-[16rem]")}
      >
        <span className="truncate">{value ? `${label}: ${value}` : emptyValue ? `${label}: ${emptyValue}` : label}</span>
        <ChevronDown aria-hidden className="h-3 w-3 shrink-0" />
      </button>
      <div
        id={panelId}
        role="group"
        aria-label={`${label} filter`}
        hidden={!open}
        className="absolute left-0 z-40 mt-1 w-[min(18rem,calc(100vw-2rem))] sm:left-auto sm:right-0 space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 shadow-[var(--e-elevation-3)]"
      >
        {children}
      </div>
    </div>
  );
}
