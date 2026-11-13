"use client";

/**
 * The property page tabs as drawn, with counts where the drawing has them.
 * A real tablist: arrow keys, Home and End move between tabs; the bar
 * scrolls sideways on a phone instead of wrapping.
 */
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { PROPERTY_TABS, PROPERTY_TAB_LABEL, type PropertyTab } from "@/lib/properties/detail-tabs";

export function PropertyTabBar({ active, counts, onSelect }: { active: PropertyTab; counts: Partial<Record<PropertyTab, number>>; onSelect: (tab: PropertyTab) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = PROPERTY_TABS.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    refs.current[target]?.focus();
    onSelect(PROPERTY_TABS[target]);
  }

  return (
    // Phones (board M-Properties): the section tabs stay in reach under the app bar while scrolling.
    <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:sticky max-sm:top-16 max-sm:z-20 max-sm:-mx-4 max-sm:bg-[hsl(var(--e-background)/0.95)] max-sm:px-4 max-sm:backdrop-blur">
      <div role="tablist" aria-label="Property sections" className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {PROPERTY_TABS.map((tab, index) => {
          const selected = tab === active;
          const count = counts[tab];
          return (
            <button
              key={tab}
              ref={(element) => { refs.current[index] = element; }}
              type="button"
              role="tab"
              id={`property-tab-button-${tab}`}
              aria-selected={selected}
              aria-controls={`property-tab-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "-mb-px inline-flex min-h-[2.75rem] items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[0.8125rem] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                selected
                  ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]"
                  : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
              )}
            >
              {PROPERTY_TAB_LABEL[tab]}
              {typeof count === "number" ? <span className="e-tnum">{count}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
