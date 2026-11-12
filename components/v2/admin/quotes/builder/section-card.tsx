"use client";

/**
 * Small layout pieces for the quote page: a numbered section card (the
 * board's `.card` with an eyebrow and a right-hand slot) and a lazy
 * disclosure that mounts its content on first open and keeps it (and any
 * draft in it) mounted while collapsed.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { ECard, ECardBody } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";

export function SectionCard({ eyebrow, aside, id, className, children }: { eyebrow: string; aside?: React.ReactNode; id?: string; className?: string; children: React.ReactNode }) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} id={id} className={cn("min-w-0 scroll-mt-20", className)}>
      <ECard className="h-full">
        <ECardBody className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={headingId} className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">
              {eyebrow}
            </h2>
            {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
          </div>
          {children}
        </ECardBody>
      </ECard>
    </section>
  );
}

export function LazyDisclosure({ title, description, defaultOpen = false, children }: { title: string; description: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [mounted, setMounted] = React.useState(defaultOpen);
  const contentId = React.useId();
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          setMounted(true);
          setOpen((value) => !value);
        }}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]">{title}</span>
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{description}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open ? "rotate-180" : "")} aria-hidden />
      </button>
      <div id={contentId} hidden={!open} className="border-t border-[hsl(var(--e-border))] p-3">
        {mounted ? children : null}
      </div>
    </div>
  );
}

/** Toggle chip with a pressed state (the board's `.chip`). */
export function ToggleChip({ pressed, onClick, disabled, title, children }: { pressed: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex min-h-[36px] items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] font-[550] disabled:cursor-not-allowed disabled:opacity-50",
        pressed
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]",
      )}
    >
      {children}
    </button>
  );
}
