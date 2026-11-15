/**
 * Building blocks shared by the creation pages drawn in batch 4 (Invite
 * person, Add client): a numbered step card with its h2, a choice card, the
 * "what one press does" summary rail and a result notice in the tone band.
 * No hooks and no "use client": safe to render from client pages; nothing here
 * is a plain value a server page needs.
 */
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EToneCard, type ETone } from "@/components/v2/ui/tone-band";

export function StepCard({
  id,
  step,
  title,
  done,
  aside,
  children,
  className,
}: {
  id?: string;
  step: number;
  title: string;
  done: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = `${id ?? `step-${step}`}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 sm:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-hidden
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold",
            done ? "bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]" : "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-muted-foreground))]",
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : step}
        </span>
        <h2 id={headingId} className="text-[1rem] font-semibold">
          {title}
          <span className="sr-only">{done ? " (complete)" : " (to do)"}</span>
        </h2>
        {aside ? <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function ChoiceCard({
  selected,
  title,
  description,
  onSelect,
  disabled,
  name,
}: {
  selected: boolean;
  title: string;
  description: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Radio group name: the cards are one choice. */
  name: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[4.5rem] min-w-0 cursor-pointer flex-col gap-1 rounded-[var(--e-radius)] border p-3 text-left transition-colors focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))]",
        selected ? "border-[hsl(var(--e-primary)/0.5)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]",
        disabled && "cursor-not-allowed bg-[hsl(var(--e-surface-raised))] opacity-80",
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={selected} disabled={disabled} onChange={onSelect} />
      <span className="text-[0.875rem] font-semibold">{title}</span>
      <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{description}</span>
    </label>
  );
}

export type SummaryRow = { label: string; value: React.ReactNode };

export function SummaryRail({
  title,
  issues,
  rows,
  action,
  note,
}: {
  title: string;
  /** Things still to fix; none = "Ready". */
  issues: number;
  rows: SummaryRow[];
  action: React.ReactNode;
  note: React.ReactNode;
}) {
  const ready = issues === 0;
  return (
    <EToneCard
      tone={ready ? "good" : "attention"}
      aria-label={title}
      header={
        <div>
          <p className="text-[0.9375rem] font-semibold">{title}</p>
          <p className="text-[0.75rem] opacity-80">One save</p>
        </div>
      }
      pill={ready ? "Ready" : `${issues} to fix`}
    >
      <dl className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2">
            <dt className="text-[hsl(var(--e-muted-foreground))]">{row.label}</dt>
            <dd className="min-w-0 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">{action}</div>
      <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{note}</p>
    </EToneCard>
  );
}

export function ResultNotice({
  tone,
  title,
  subtitle,
  pill,
  children,
  live = "polite",
}: {
  tone: ETone;
  title: string;
  subtitle: string;
  pill: string;
  children: React.ReactNode;
  live?: "polite" | "assertive";
}) {
  return (
    <div role={live === "assertive" ? "alert" : "status"} aria-live={live}>
      <EToneCard
        tone={tone}
        header={
          <div>
            <p className="text-[0.9375rem] font-semibold">{title}</p>
            <p className="text-[0.75rem] opacity-80">{subtitle}</p>
          </div>
        }
        pill={pill}
      >
        <div className="space-y-3 text-[0.8125rem]">{children}</div>
      </EToneCard>
    </div>
  );
}

/** The link shown when an invitation could not be emailed. */
export function LinkBox({ link }: { link: string }) {
  return (
    <p className="break-all rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 font-mono text-[0.75rem]">{link}</p>
  );
}

/** A new random key for a repeat-safe submit. */
export function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}
