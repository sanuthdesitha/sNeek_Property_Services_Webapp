"use client";

import { cn } from "@/lib/utils";

export type AccessTab = "person" | "area" | "presets" | "assistants" | "history";

const TABS: Array<{ key: AccessTab; label: string; count?: "person" | "presets" | "assistants" }> = [
  { key: "person", label: "By person", count: "person" },
  { key: "area", label: "By area" },
  { key: "presets", label: "Presets", count: "presets" },
  { key: "assistants", label: "Client assistants", count: "assistants" },
  { key: "history", label: "History" },
];

/** Views of the same draft; switching keeps unsaved changes. */
export function AccessTabs({
  active,
  counts,
  onSelect,
}: {
  active: AccessTab;
  counts: Record<"person" | "presets" | "assistants", number>;
  onSelect: (tab: AccessTab) => void;
}) {
  return (
    <div role="tablist" aria-label="Access views" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onSelect(tab.key)}
          className={cn(
            "min-h-10 shrink-0 rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550]",
            active === tab.key
              ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)] ring-1 ring-[hsl(var(--e-border))]"
              : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
          )}
        >
          {tab.label}
          {tab.count ? <span className="ml-1.5 text-[hsl(var(--e-muted-foreground))]">{counts[tab.count]}</span> : null}
        </button>
      ))}
    </div>
  );
}
