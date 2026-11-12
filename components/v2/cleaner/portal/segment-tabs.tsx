/**
 * Link-based segmented tabs for the cleaner screens (Jobs List / Month,
 * Supplies, Pay). No client state: every tab is a deep link that survives a
 * reload and works from a notification. 44px targets; the row scrolls sideways
 * inside itself on a narrow phone instead of widening the page.
 *
 * No "use client" directive: server pages render it directly.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SegmentTab {
  key: string;
  label: string;
  href: string;
  /** A real count from the server; omitted when unknown. */
  count?: number;
}

export function SegmentTabs({
  tabs,
  activeKey,
  label,
  className,
}: {
  tabs: readonly SegmentTab[];
  activeKey: string;
  /** Accessible name of the tab row, e.g. "Supplies sections". */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("-mx-1 overflow-x-auto px-1 pb-1", className)}>
      <ul className="inline-flex min-w-full gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <li key={tab.key} className="flex flex-1">
              <Link
                href={tab.href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550] transition-colors focus-visible:outline focus-visible:outline-2",
                  active
                    ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                    : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]",
                )}
              >
                {tab.label}
                {typeof tab.count === "number" && tab.count > 0 ? (
                  <span className="e-tnum rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))] px-1.5 text-[0.6875rem]">{tab.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The Jobs tab's List / Month switch (board: "Jobs (List / Month)"). */
export function JobsViewSwitch({ active, monthAvailable = true }: { active: "list" | "month"; monthAvailable?: boolean }) {
  // With the calendar module switched off there is nothing to switch to.
  if (!monthAvailable) return null;
  return (
    <SegmentTabs
      label="Jobs view"
      activeKey={active}
      className="max-w-xs"
      tabs={[
        { key: "list", label: "List", href: "/v2/cleaner/jobs" },
        { key: "month", label: "Month", href: "/v2/cleaner/calendar" },
      ]}
    />
  );
}
