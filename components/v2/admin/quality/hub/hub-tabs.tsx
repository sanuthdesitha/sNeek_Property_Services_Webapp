"use client";

/**
 * Tab row as drawn ("Review queue 5 · Issues 37 · Cleaners · …"). Links, so
 * every tab is deep-linkable and keeps the period and filters. A count shows
 * only when the server sent one.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { QUALITY_TAB_LABEL, type QualityTab } from "@/lib/quality/types";

export function QualityTabs({
  tabs,
  active,
  counts,
  hrefFor,
}: {
  tabs: readonly QualityTab[];
  active: QualityTab;
  counts: Partial<Record<QualityTab, number>>;
  hrefFor: (tab: QualityTab) => string;
}) {
  return (
    <nav aria-label="Quality sections" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {tabs.map((tab) => {
          const isActive = tab === active;
          const count = counts[tab];
          return (
            <Link
              key={tab}
              href={hrefFor(tab)}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-[2.5rem] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                isActive
                  ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]"
                  : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
              )}
            >
              {QUALITY_TAB_LABEL[tab]}
              {typeof count === "number" ? <span className="e-tnum">{count}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
