"use client";

/**
 * The Workforce tab strip (board "Workforce"): links, so every tab keeps its
 * URL and old deep links still open it. On a phone it is one swipeable row
 * (board M-Workforce) that keeps the current tab in view.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { WORKFORCE_TABS, type WorkforceTabCounts, type WorkforceTabKey } from "@/lib/workforce/workforce-tabs";

export function WorkforceTabsNav({ active, counts }: { active: WorkforceTabKey; counts: WorkforceTabCounts }) {
  const phone = useIsPhone();
  const navRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!phone) return;
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && current) nav.scrollLeft = Math.max(0, current.offsetLeft - 16);
  }, [phone, active]);

  return (
    <nav ref={navRef} aria-label="Workforce sections" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:-mx-4 max-sm:px-4">
      <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {WORKFORCE_TABS.map((tab) => {
          const isActive = tab.key === active;
          const count = counts[tab.key];
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-[2.5rem] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] transition-colors max-sm:min-h-11",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                isActive
                  ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]"
                  : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
              )}
            >
              <span className="max-sm:hidden">{tab.label}</span>
              <span className="sm:hidden">{tab.phoneLabel}</span>
              {count ? (
                <span className="e-tnum">
                  {count.value}
                  {count.suffix ? <span className="max-sm:hidden"> {count.suffix}</span> : null}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
