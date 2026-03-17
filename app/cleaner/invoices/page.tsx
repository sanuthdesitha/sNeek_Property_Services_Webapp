import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { CleanerInvoicesPage } from "@/components/cleaner/invoices-page";

export default async function CleanerInvoicesRoutePage() {
  await ensureCleanerModuleAccess("invoices");
  await requireRole([Role.CLEANER]);
  return <CleanerInvoicesPage />;
}
