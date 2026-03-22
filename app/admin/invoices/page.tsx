import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ClientInvoicesPage } from "@/components/admin/client-invoices-page";

export default async function AdminInvoicesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <ClientInvoicesPage />;
}
