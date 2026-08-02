import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

/**
 * Shortcuts from the Pay page into the real invoice tool.
 *
 * These used to FIRE an invoice on the spot: one click emailed a PDF built from
 * silent defaults — no date range shown, no preview, no chance to drop a job or
 * a shopping run, no way to undo. An invoice is a payment demand; sending one
 * blind is how a wrong period or an already-settled job reaches accounts.
 *
 * So they navigate instead. `/v2/cleaner/invoices?preset=` opens the panel with
 * the period already chosen, which keeps the convenience while restoring the
 * review step that catches those mistakes. The panel owns the endpoints
 * (preview / download / send) — this component performs no fetch at all, so
 * there is no longer a second, weaker path to sending money requests.
 */
export function CleanerInvoiceActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EButton asChild variant="outline" size="sm">
        <Link href="/v2/cleaner/invoices?preset=thisMonth">
          <FileText className="h-3.5 w-3.5" />
          This month
        </Link>
      </EButton>
      <EButton asChild variant="gold" size="sm">
        <Link href="/v2/cleaner/invoices?preset=lastMonth">
          Build invoice
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </EButton>
    </div>
  );
}
