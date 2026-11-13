"use client";

/**
 * PhoneBackBar (board "Admin phone", 2026-11): the "‹ Title" bar at the top of
 * a stacked phone screen (a cleaner in Quality, a step of the form builder).
 * Render it only on a phone. The back button keeps its own accessible name so
 * the title is not read twice; `actions` sit on the right (a "⋯" menu).
 */
import * as React from "react";
import { ChevronLeft } from "lucide-react";

export type PhoneBackBarProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Accessible name of the back button, e.g. "Back to cleaners". */
  backLabel: string;
  onBack: () => void;
  actions?: React.ReactNode;
  /** Render the title as this heading level (the page keeps its one h1). */
  headingLevel?: 2 | 3;
};

export function PhoneBackBar({ title, subtitle, backLabel, onBack, actions, headingLevel = 2 }: PhoneBackBarProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex items-center gap-2" data-phone-back-bar="">
      <button
        type="button"
        aria-label={backLabel}
        onClick={onBack}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        <ChevronLeft aria-hidden className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <Heading className="truncate text-[0.9375rem] font-[600]">{title}</Heading>
        {subtitle ? <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}
