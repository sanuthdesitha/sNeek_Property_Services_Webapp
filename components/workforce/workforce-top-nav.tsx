import Link from "next/link";
import { cn } from "@/lib/utils";

type TopTab = {
  value: string;
  label: string;
};

/**
 * Top-level tab strip for the unified Workforce hub. Server-rendered, driven by
 * the `?tab=` search param (Team vs Performance) so each tab can keep its own
 * data-fetching / role model. The Team tab hosts the original workforce hub
 * (with its own internal sub-tabs); Performance hosts the leaderboard.
 */
export function WorkforceTopNav({ active }: { active: string }) {
  const tabs: TopTab[] = [
    { value: "team", label: "Team" },
    { value: "performance", label: "Performance" },
  ];

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-surface-raised p-1">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        const href =
          tab.value === "team"
            ? "/admin/workforce"
            : `/admin/workforce?tab=${tab.value}`;
        return (
          <Link
            key={tab.value}
            href={href}
            className={cn(
              "rounded-sm px-4 py-1.5 text-sm font-medium transition-all",
              isActive
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
