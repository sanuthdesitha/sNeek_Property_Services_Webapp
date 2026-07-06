import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerInvoicesTabs } from "@/components/v2/admin/cleaner-invoices/cleaner-invoices-tabs";

export const metadata = { title: "Cleaner invoices · Estate admin" };
export const dynamic = "force-dynamic";

export default async function CleanerInvoicesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Finance"
        title="Cleaner invoices"
        description="Predict what each cleaner will invoice before they submit, then review and settle the invoices they've sent — push to Xero, mark paid, reverse or delete (a reversed/deleted invoice lets the cleaner resend a corrected one)."
      />
      <CleanerInvoicesTabs />
    </div>
  );
}
