"use client";

/** Small pieces shared by the AI configuration sections. Estate tokens only. */
import * as React from "react";
import { cn } from "@/lib/utils";

export const AI_FIELD = "h-10 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] text-[hsl(var(--e-foreground))] sm:h-8 sm:text-[0.8125rem] disabled:opacity-60 max-sm:h-11";
export const AI_LABEL = "mb-1 block text-[0.75rem] font-semibold text-[hsl(var(--e-text-secondary))]";
export const AI_MUTED = "text-[hsl(var(--e-muted-foreground))]";

/** "Section 1" eyebrow, the h2 and a one-line aside, as on the board. */
export function AiSectionHeading({ id, number, title, aside }: { id: string; number: number; title: string; aside?: React.ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <span className="mb-0.5 block text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">Section {number}</span>
        <h2 id={id} className="font-[family-name:var(--e-font-serif)] text-[1.375rem] font-medium leading-tight">{title}</h2>
      </div>
      {aside ? <div className={cn("min-w-0 text-[0.75rem]", AI_MUTED)}>{aside}</div> : null}
    </div>
  );
}

/**
 * A native checkbox drawn as a switch: keyboard, label and screen readers
 * keep the native semantics (role="switch" announces on/off).
 */
export function AiSwitch({ checked, onChange, label, disabled = false, labelHidden = true, className }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  labelHidden?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("relative inline-flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-8", disabled && "cursor-not-allowed", className)}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="peer absolute h-px w-px opacity-0"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          "relative inline-block h-[26px] w-11 shrink-0 rounded-full transition-colors sm:h-5 sm:w-9",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[hsl(var(--e-ring))]",
          checked ? "bg-[hsl(var(--e-primary))]" : "bg-[hsl(var(--e-border-strong))]",
          disabled && "opacity-45",
        )}
      >
        <span className={cn("absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-all sm:top-[2px] sm:h-4 sm:w-4", checked ? "right-[3px] sm:right-[2px]" : "left-[3px] sm:left-[2px]")} />
      </span>
      <span className={labelHidden ? "sr-only" : "text-[0.8125rem]"}>{label}</span>
    </label>
  );
}

/** Local / Cloud tag that names where requests go. */
export function AiWhereTag({ local, children }: { local: boolean; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 self-start rounded-[6px] px-1.5 py-px text-[0.6875rem] font-semibold",
      local ? "bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]" : "bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]",
    )}>
      <span aria-hidden>{local ? "⌂" : "☁"}</span>
      {children}
    </span>
  );
}

export function AiModelChips({ models }: { models: string[] }) {
  if (models.length === 0) return <span className={AI_MUTED}>None in use</span>;
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {models.map((model) => (
        <span key={model} className="break-all rounded-[5px] bg-[hsl(var(--e-surface-raised))] px-1.5 py-px font-mono text-[0.6875rem]">{model}</span>
      ))}
    </span>
  );
}

/** A small spinner for Queued and Running; decorative, the words carry the state. */
export function AiSpinner() {
  return <span aria-hidden className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-[hsl(var(--e-border-strong))] border-t-[hsl(var(--e-primary))] align-[-2px] motion-reduce:animate-none" />;
}

export type ResultTone = "ok" | "bad" | "none";

export function AiResultText({ tone, children, className }: { tone: ResultTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "text-[0.71875rem]",
      tone === "ok" && "font-semibold text-[hsl(var(--e-success))]",
      tone === "bad" && "font-semibold text-[hsl(var(--e-danger))]",
      tone === "none" && "text-[hsl(var(--e-muted-foreground))]",
      className,
    )}>{children}</span>
  );
}
