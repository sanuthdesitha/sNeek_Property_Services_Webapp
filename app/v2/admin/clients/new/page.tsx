import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { NewClientForm } from "@/components/v2/admin/clients/new-client-form";
import { organisationDefaultTermsDays } from "@/lib/billing/invoice-terms";
import { canEditClientPaymentTerms } from "@/lib/billing/client-payment-terms";
import { hasActiveXeroConnection } from "@/lib/xero/client";
import { resolveAccountCreator } from "@/lib/accounts/account-creator";
import { clientLoginRefusal } from "@/lib/accounts/create-account-rules";

export const metadata = { title: "Add client · Estate admin" };
export const dynamic = "force-dynamic";

/** Add client (board "Add client", 2026-11-16). The server decides terms, Xero and login rights; the route checks them again. */
export default async function V2NewClientPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const actor = { id: session.user.id, role: String(session.user.role), heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String) };
  const [defaultTermsDays, canEditTerms, xeroConnected, creator] = await Promise.all([
    organisationDefaultTermsDays(),
    canEditClientPaymentTerms(actor),
    hasActiveXeroConnection(),
    resolveAccountCreator(session),
  ]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow={<Link href="/v2/admin/accounts?tab=clients" className="underline-offset-2 hover:underline">← Clients</Link>}
        title="Add client"
        description="The company or person we bill. Properties come next, through onboarding. Nothing is sent until you press Add client."
      />
      <NewClientForm defaultTermsDays={defaultTermsDays} canEditTerms={canEditTerms} xeroConnected={xeroConnected} loginRefusal={clientLoginRefusal(creator)} />
    </div>
  );
}
