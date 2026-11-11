"use client";

/**
 * Tab row for Invoices and pay, in the concept's large underlined style.
 * Link-driven (`?tab=`), so every tab is deep-linkable and survives reload.
 * "Adjustments and time" covers the old `adjustments` and `time` keys; both
 * still work and choose its sub-view.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EPill } from "@/components/v2/ui/pill";

export type FinanceTabKey = "invoices" | "cleaner-invoices" | "payroll" | "adjustments" | "overview";

export const FINANCE_TAB_LABEL: Record<FinanceTabKey, string> = {
  invoices: "Client invoices",
  "cleaner-invoices": "Cleaner invoices",
  payroll: "Pay runs",
  adjustments: "Adjustments and time",
  overview: "Overview",
};

export type FinanceTabBadges = { clientToSend: number | null; cleanerToReview: number | null };

export function FinanceTabNavV2({
  active,
  tabs,
  badges,
}: {
  active: FinanceTabKey;
  /** Tabs this viewer may open (operations-manager packs can hide some). */
  tabs: FinanceTabKey[];
  badges: FinanceTabBadges;
}) {
  function badgeFor(key: FinanceTabKey) {
    if (key === "invoices" && badges.clientToSend) return <EPill tone="gold">{badges.clientToSend} to send</EPill>;
    if (key === "cleaner-invoices" && badges.cleanerToReview) return <EPill tone="warn">{badges.cleanerToReview} to review</EPill>;
    return null;
  }

  return (
    <nav aria-label="Invoices and pay sections" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-7 border-b border-[hsl(var(--e-border))]">
        {tabs.map((key) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={`/v2/admin/finance?tab=${key}`}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap border-b-2 px-0.5 text-[0.875rem] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                isActive
                  ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]"
                  : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]",
              )}
            >
              {FINANCE_TAB_LABEL[key]}
              {badgeFor(key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
