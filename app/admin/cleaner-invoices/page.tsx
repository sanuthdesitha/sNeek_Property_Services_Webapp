import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { CleanerInvoicesReview } from "@/components/admin/cleaner-invoices-review";

export const dynamic = "force-dynamic";

export default async function AdminCleanerInvoicesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <CleanerInvoicesReview />;
}
