import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { InvoiceEditorPage } from "@/components/v2/admin/finance/invoices/editor/invoice-editor-page";
import { PracticeBoundary } from "@/components/v2/tutorials/practice-boundary";
import { practiceInvoice } from "@/lib/tutorials/practice-samples";

export const metadata = { title: "Practice invoice · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * "Send an invoice" practice (board "Admin tours", D): the real invoice editor
 * showing the sample INV-P001. Nothing is read from or written to the
 * database; the practice guard stops every write in the browser, so nothing is
 * emailed or sent to Xero. The page h1 is the editor's own.
 */
export default async function PracticeInvoicePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  return (
    <PracticeBoundary tourKey="admin.finance.send">
      <InvoiceEditorPage initial={practiceInvoice(settings?.timezone ?? "Australia/Sydney")} backHref="/v2/admin/finance?tab=invoices" />
    </PracticeBoundary>
  );
}
