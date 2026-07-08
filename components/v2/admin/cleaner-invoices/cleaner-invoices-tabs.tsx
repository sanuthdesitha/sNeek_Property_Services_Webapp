"use client";

/**
 * Client tab switch for the admin cleaner-invoices page. Two surfaces over the
 * same cleaner-invoice domain:
 *   • "Submitted" — the existing CleanerInvoicesWorkspace (invoices cleaners have
 *     actually sent: review, Xero push, mark paid, reverse/delete). Untouched.
 *   • "Predicted" — the native ExpectedInvoicesPanel: what each active cleaner is
 *     expected to invoice this period BEFORE they submit (money to prepare +
 *     per-invoice transparency + submitted-vs-expected reconciliation).
 *
 * A local segmented control (not EChipTabs, which is href/navigation-driven)
 * keeps both views mounted-on-demand within one page without a route change.
 */
import * as React from "react";
import { FileCheck2, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { CleanerInvoicesWorkspace } from "@/components/v2/admin/cleaner-invoices/cleaner-invoices-workspace";
import { ExpectedInvoicesPanel } from "@/components/v2/admin/cleaner-invoices/expected-invoices-panel";

type TabKey = "submitted" | "predicted";

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "submitted", label: "Submitted", icon: <FileCheck2 className="h-3.5 w-3.5" /> },
  { key: "predicted", label: "Predicted", icon: <LineChart className="h-3.5 w-3.5" /> },
];

export function CleanerInvoicesTabs() {
  const [tab, setTab] = React.useState<TabKey>("submitted");

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3.5 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors duration-[160ms]",
                  active
                    ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                    : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]"
                )}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "submitted" ? <CleanerInvoicesWorkspace /> : <ExpectedInvoicesPanel />}
    </div>
  );
}
