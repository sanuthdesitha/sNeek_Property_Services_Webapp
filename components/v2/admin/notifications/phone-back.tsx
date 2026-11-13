"use client";

import { ChevronLeft } from "lucide-react";

/**
 * "‹ Title" bar at the top of a stacked phone screen in Notifications (board
 * "M-Notifications"). Only rendered on a phone; the back button keeps its own
 * accessible name so the title is not read twice.
 */
export function NotificationsPhoneBack({ title, subtitle, backLabel, onBack }: { title: string; subtitle?: string; backLabel: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2" data-phone-back="">
      <button
        type="button"
        aria-label={backLabel}
        onClick={onBack}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        <ChevronLeft aria-hidden className="h-5 w-5" />
      </button>
      <span className="min-w-0">
        <span className="block truncate text-[0.9375rem] font-[600]">{title}</span>
        {subtitle ? <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{subtitle}</span> : null}
      </span>
    </div>
  );
}
