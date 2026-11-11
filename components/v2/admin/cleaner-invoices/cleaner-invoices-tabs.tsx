"use client";

import { useRestorableState } from "@/hooks/use-restorable-state";

/**
 * The Cleaner invoices tab's two views over the same domain:
 *   • "Submitted" — invoices payees have sent: the paged table, review page,
 *     approve, Xero, payment, reverse, delete.
 *   • "Predicted" — what each active payee is expected to invoice before they
 *     submit (unchanged in function).
 * The switch uses the shared filter chips (toggle buttons) and remembers the
 * last view.
 */
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { CleanerInvoicesWorkspace } from "@/components/v2/admin/cleaner-invoices/cleaner-invoices-workspace";
import { ExpectedInvoicesPanel } from "@/components/v2/admin/cleaner-invoices/expected-invoices-panel";

type ViewKey = "submitted" | "predicted";

export function CleanerInvoicesTabs({ role }: { role: string }) {
  const [view, setView] = useRestorableState<ViewKey>("cleaner-invoices-tabs:tab", "submitted");
  return (
    <div className="space-y-4">
      <EFilterChips
        label="Cleaner invoice view"
        chips={[
          { key: "submitted", label: "Submitted" },
          { key: "predicted", label: "Predicted" },
        ]}
        active={view}
        onChange={setView}
      />
      {view === "predicted" ? <ExpectedInvoicesPanel /> : <CleanerInvoicesWorkspace role={role} />}
    </div>
  );
}
