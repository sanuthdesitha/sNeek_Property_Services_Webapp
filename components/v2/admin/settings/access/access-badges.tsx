"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "warn" | "gold" | "ok" | "neutral";

const TONES: Record<Tone, string> = {
  warn: "bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-foreground))] border-[hsl(var(--e-warning))]",
  gold: "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))] border-[hsl(var(--e-border-gold))]",
  ok: "bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-foreground))] border-[hsl(var(--e-success))]",
  neutral: "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-text-secondary))] border-[hsl(var(--e-border))]",
};

export function AccessBadge({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center rounded-[var(--e-radius-pill)] border px-1.5 py-px text-[0.6875rem] font-[600] leading-4", TONES[tone])}
    >
      {children}
    </span>
  );
}

/** The "!" or "Sensitive" mark: asked for a PIN, only with Full or an individual grant. */
export function SensitiveBadge({ short = false }: { short?: boolean }) {
  return (
    <AccessBadge tone="warn" title="Sensitive: asked for a PIN">
      {short ? "!" : "Sensitive"}
      {short ? <span className="sr-only"> includes sensitive actions</span> : null}
    </AccessBadge>
  );
}
