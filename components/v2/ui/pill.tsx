/**
 * ESTATE status pill: the concept's `.b` badge — a 20px soft pill, colour from
 * the tone, always with written text (colour alone never carries status).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type EPillTone = "neutral" | "ok" | "warn" | "bad" | "info" | "gold";

const TONE: Record<EPillTone, string> = {
  neutral: "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-text-secondary))]",
  ok: "bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]",
  warn: "bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]",
  bad: "bg-[hsl(var(--e-danger-soft))] text-[hsl(var(--e-danger))]",
  info: "bg-[hsl(var(--e-info-soft))] text-[hsl(var(--e-info))]",
  gold: "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]",
};

export function EPill({ tone = "neutral", className, children }: { tone?: EPillTone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center whitespace-nowrap rounded-[var(--e-radius-pill)] px-2 text-[0.6875rem] font-[600]",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
