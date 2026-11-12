import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { loadCleanerInvoiceReview } from "@/lib/cleaner/invoice-review";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerInvoiceReviewPage } from "@/components/v2/admin/cleaner-invoices/review/cleaner-invoice-review-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cleaner invoice · Estate admin" };

/** Only same-origin list views are accepted as the back link. */
function backHref(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.startsWith("/v2/admin/finance?") ? value : "/v2/admin/finance?tab=cleaner-invoices";
}

/**
 * Read-only review of one payee invoice. Same roles as the cleaner-invoice API;
 * an operations manager also needs the payroll feature (the tab's mapping).
 * Approve is shown to administrators only (the server refuses it otherwise).
 */
export default async function CleanerInvoiceReviewRoute({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { back?: string | string[] };
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const levels = await getOpsAccess(session.user);
  if (levels && !canUseOpsPath(levels, "/v2/admin/finance?tab=cleaner-invoices")) {
    return (
      <div className="space-y-5">
        <EPageHeader title="Cleaner invoice" />
        <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">This section is not available to your account.</p>
      </div>
    );
  }
  const review = await loadCleanerInvoiceReview(params.id);
  if (!review) notFound();
  return <CleanerInvoiceReviewPage key={review.row.id} review={review} role={session.user.role} backHref={backHref(searchParams?.back)} />;
}
