"use client";

/**
 * Small building blocks of the New job page, drawn from Estate tokens only:
 * the numbered section card, the "from property" mark, choice chips, the
 * segmented control and label/value rows. No coloured left lines anywhere.
 */
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ECard } from "@/components/v2/ui/primitives";

export function SectionCard({
  id,
  index,
  done,
  title,
  aside,
  children,
  className,
}: {
  id: string;
  index: number;
  done: boolean;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-24", className)}>
      <ECard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[0.75rem] font-[600]",
                done
                  ? "border-[hsl(var(--e-band-good-line))] bg-[hsl(var(--e-band-good-bg))] text-[hsl(var(--e-band-good-fg))]"
                  : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))]",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index}
            </span>
            <h2 id={headingId} className="text-[1rem] font-[600] text-[hsl(var(--e-foreground))]">
              {title}
              <span className="sr-only">{done ? " (complete)" : ""}</span>
            </h2>
          </div>
          {aside ? <div className="min-w-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{aside}</div> : null}
        </div>
        <div className="space-y-4 px-4 pb-4 pt-1 sm:px-5 sm:pb-5">{children}</div>
      </ECard>
    </section>
  );
}

/** "from property" (or "changed") beside a prefilled value. */
export function SourceMark({ changed = false, label }: { changed?: boolean; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-[550]",
        changed
          ? "border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))]"
          : "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]",
      )}
    >
      {label ?? (changed ? "changed" : "from property")}
    </span>
  );
}

/** The sky "new" mark the board uses for what this page adds. */
export function NewMark() {
  return (
    <span className="inline-flex items-center rounded-full border border-[hsl(var(--e-band-info-line))] bg-[hsl(var(--e-band-info-bg))] px-1.5 py-0.5 text-[0.625rem] font-[600] uppercase tracking-wide text-[hsl(var(--e-band-info-fg))]">
      new
    </span>
  );
}

export function ChoiceChip({
  selected,
  onClick,
  children,
  disabled,
  describedBy,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 text-[0.8125rem] transition-colors max-sm:min-h-[44px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-50",
        selected
          ? "border-[hsl(var(--e-band-good-line))] bg-[hsl(var(--e-band-good-bg))] font-[550] text-[hsl(var(--e-band-good-fg))]"
          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))]",
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-0.5", className)}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-[32px] flex-1 whitespace-nowrap rounded-[calc(var(--e-radius)-2px)] px-3 text-[0.8125rem] transition-colors max-sm:min-h-[44px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
              on ? "bg-[hsl(var(--e-surface))] font-[550] text-[hsl(var(--e-foreground))] shadow-sm" : "text-[hsl(var(--e-text-secondary))]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** One label/value line of a "filled from the property" list. */
export function FactRow({ label, children, mark, action }: { label: string; children: ReactNode; mark?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-[hsl(var(--e-border))] py-2.5 first:border-t-0 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
      <div className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{label}</div>
      <div className="min-w-0 break-words text-[0.875rem] text-[hsl(var(--e-foreground))]">{children}</div>
      {mark || action ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{action}{mark}</div> : null}
    </div>
  );
}

export function Faint({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[0.8125rem] text-[hsl(var(--e-text-secondary))]", className)}>{children}</span>;
}

/** A plain secondary disclosure that keeps its contents mounted once opened. */
export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] open:bg-[hsl(var(--e-surface))]" open={defaultOpen || undefined}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
        {summary}
      </summary>
      <div className="space-y-3 border-t border-[hsl(var(--e-border))] p-3">{children}</div>
    </details>
  );
}
