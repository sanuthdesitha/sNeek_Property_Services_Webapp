"use client";

/**
 * People tabs as drawn ("Clients 18 · Cleaners 14 · …") with real counts.
 * Links, so each tab is deep-linkable; a plain click switches in place.
 * Everyone / Needs attention / Client logins are chips inside the tabs, so
 * no drawn tab is marked current on those views.
 */
import { cn } from "@/lib/utils";
import type { PeopleCounts } from "@/lib/people/counts";
import { allowedPeopleTabs, PEOPLE_TABS, PEOPLE_TAB_LABEL, type PeopleAccess, type PeopleMainTab, type PeopleTab } from "@/lib/people/tabs";

const COUNT_FOR: Record<PeopleMainTab, keyof PeopleCounts> = {
  clients: "clients",
  cleaners: "cleaners",
  office: "office",
  partners: "partners",
  assistants: "assistants",
  invitations: "invitationsOpen",
};

export function PeopleTabs({
  active,
  counts,
  access,
  onSelect,
}: {
  active: PeopleTab;
  counts: PeopleCounts;
  access: PeopleAccess;
  onSelect: (tab: PeopleTab) => void;
}) {
  const allowed = allowedPeopleTabs(access);
  const tabs = PEOPLE_TABS.filter((tab) => allowed.includes(tab));
  return (
    <nav aria-label="People groups" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {tabs.map((tab) => {
          const isActive = tab === active;
          const value = counts[COUNT_FOR[tab]];
          return (
            <a
              key={tab}
              href={`/v2/admin/accounts?tab=${tab}`}
              aria-current={isActive ? "page" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                onSelect(tab);
              }}
              className={cn(
                "-mb-px inline-flex min-h-[2.5rem] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                isActive
                  ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]"
                  : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
              )}
            >
              {PEOPLE_TAB_LABEL[tab]}
              {typeof value === "number" ? <span className="e-tnum">{value}</span> : null}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
