"use client";

/**
 * Coaching tab: the existing coaching workspace embedded as a panel (it has
 * no page heading of its own, so the hub keeps one h1). It keeps its own
 * cleaner / type / status filters and its create and update flows; the hub's
 * period does not apply, because open coaching is live work.
 */
import Link from "next/link";
import { CoachingWorkspace } from "@/components/v2/admin/workforce/coaching-workspace";

export function CoachingTab() {
  return (
    <section aria-labelledby="coaching-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="coaching-heading" className="e-eyebrow">Coaching records</h2>
        <Link href="/v2/admin/workforce/coaching" className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
          Open the full coaching page
        </Link>
      </div>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Recommendations authored by managers and acknowledged by cleaners. This list has its own filters; the period above does not apply.
      </p>
      <CoachingWorkspace />
    </section>
  );
}
