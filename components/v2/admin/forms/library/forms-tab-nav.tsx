"use client";

/**
 * Tab row of the Forms library, link-driven (`?tab=`), so every tab can be
 * linked and survives reload. Counts are real totals from the server, shown
 * only where the concept shows them.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { FormsLibraryTab } from "@/lib/admin/forms-redirects";

import { FORMS_TAB_LABEL } from "./forms-tab-labels";

export function FormsTabNav({
  active,
  tabs,
  counts,
}: {
  active: FormsLibraryTab;
  tabs: FormsLibraryTab[];
  counts: Partial<Record<FormsLibraryTab, number | null>>;
}) {
  return (
    <nav aria-label="Forms sections" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {tabs.map((key) => {
          const isActive = key === active;
          const count = counts[key];
          return (
            <Link
              key={key}
              href={`/v2/admin/forms?tab=${key}`}
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
              {FORMS_TAB_LABEL[key]}
              {typeof count === "number" ? <span className="e-tnum">{count}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
