"use client";

/**
 * Role tabs as drawn ("Everyone 31 · Cleaners 14 · …"), with the server's real
 * counts. Links, so each tab is deep-linkable; a plain click switches in place.
 */
import { cn } from "@/lib/utils";
import { ACCOUNT_TABS, ACCOUNT_TAB_LABEL, type AccountTab } from "@/lib/accounts/list/tabs";

export function AccountsTabs({
  active,
  counts,
  onSelect,
}: {
  active: AccountTab;
  counts: Partial<Record<AccountTab, number>> | null;
  onSelect: (tab: AccountTab) => void;
}) {
  return (
    <nav aria-label="Account types" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
        {ACCOUNT_TABS.map((tab) => {
          const isActive = tab === active;
          const count = counts?.[tab];
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
              {ACCOUNT_TAB_LABEL[tab]}
              {typeof count === "number" ? <span className="e-tnum">{count}</span> : null}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
