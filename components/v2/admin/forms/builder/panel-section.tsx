"use client";

/** Self-contained Estate accordion section used by the builder's panels. */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function PanelSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const bodyId = React.useId();
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]"
      >
        {title}
        <ChevronDown className={cn("size-4 shrink-0 text-[hsl(var(--e-text-faint))] transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div id={bodyId} className="space-y-3 border-t border-[hsl(var(--e-border))] px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
