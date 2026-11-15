import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { newInvoiceAccess } from "@/lib/billing/client-invoice-access";
import { listInvoiceFormContext } from "@/lib/billing/client-invoices";
import { can } from "@/lib/rbac/can";
import { getAppSettings } from "@/lib/settings";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { NewInvoicePanel } from "@/components/v2/admin/finance/invoices/new-invoice/new-invoice-panel";
import { parseNewInvoiceKind } from "@/components/v2/admin/finance/invoices/new-invoice/new-invoice-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "New invoice · Estate admin" };

/**
 * New invoice (board "New invoice"): from finished jobs, blank invoice or
 * credit note in one panel. Same roles as the invoice API (ADMIN and
 * OPS_MANAGER); an operations manager needs the finance feature to open it
 * and "manage" on it to create. `?kind=jobs|blank|credit` picks the choice
 * and `?clientId=` preselects a client.
 */
export default async function NewInvoiceRoute({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const access = await newInvoiceAccess(session.user);
  if (!access.canView) {
    return (
      <div className="space-y-5">
        <EPageHeader title="New invoice" />
        <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
          This section is not available to your account.
        </p>
      </div>
    );
  }
  const [context, settings, canVoidCredit] = await Promise.all([
    listInvoiceFormContext(),
    getAppSettings().catch(() => null),
    can(session, "invoices.void_credit"),
  ]);
  const requestedClient = typeof searchParams?.clientId === "string" ? searchParams.clientId : "";
  const initialClientId = context.clients.some((client) => client.id === requestedClient) ? requestedClient : "";
  return (
    <NewInvoicePanel
      context={{ clients: context.clients, properties: context.properties.map((property) => ({ ...property, suburb: property.suburb ?? "" })) }}
      initialKind={parseNewInvoiceKind(searchParams?.kind)}
      initialClientId={initialClientId}
      canManage={access.canManage}
      canVoidCredit={canVoidCredit}
      timeZone={settings?.timezone || "Australia/Sydney"}
    />
  );
}
