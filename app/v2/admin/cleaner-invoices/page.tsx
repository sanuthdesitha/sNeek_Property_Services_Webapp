import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerInvoicesWorkspace } from "@/components/v2/admin/cleaner-invoices/cleaner-invoices-workspace";

export const metadata = { title: "Cleaner invoices · Estate admin" };
export const dynamic = "force-dynamic";

export default async function CleanerInvoicesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Finance"
        title="Cleaner invoices"
        description="Invoices your cleaners submit from their portal — review, push to Xero, mark paid, reverse or delete (a reversed/deleted invoice lets the cleaner resend a corrected one)."
      />
      <CleanerInvoicesWorkspace />
    </div>
  );
}
