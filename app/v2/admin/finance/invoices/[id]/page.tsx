import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { invoiceEditorAccess } from "@/lib/billing/client-invoice-access";
import { loadClientInvoiceEditor } from "@/lib/billing/client-invoice-editor";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { InvoiceEditorPage } from "@/components/v2/admin/finance/invoices/editor/invoice-editor-page";
import { invoiceListHref } from "@/components/v2/admin/finance/invoices/invoice-links";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice · Estate admin" };

/**
 * The client invoice editor. Same roles as the invoice API (ADMIN and
 * OPS_MANAGER); an operations manager also needs the finance feature, and
 * without "manage" on it sees the invoice read-only. `?back=` carries the list
 * view it was opened from; old deep links without it return to the plain list.
 * (This route used to render a read-only summary; the client portal keeps its
 * own summary page.)
 */
export default async function AdminInvoiceEditorRoute({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { back?: string | string[] };
}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const access = await invoiceEditorAccess(session.user, params.id);
  if (!access.canView) {
    return (
      <div className="space-y-5">
        <EPageHeader title="Invoice" />
        <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
          This section is not available to your account.
        </p>
      </div>
    );
  }
  const data = await loadClientInvoiceEditor(params.id, { canManage: access.canManage });
  if (!data) notFound();
  return <InvoiceEditorPage key={data.row.id} initial={data} backHref={invoiceListHref(searchParams?.back)} />;
}
