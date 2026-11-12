import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { getClientPortalContext } from "@/lib/client/portal";
import { listQuotesWaiting } from "@/lib/client/quotes-waiting";
import { ClientApprovalsBoard, type ApprovalsView } from "@/components/v2/client/approvals-board";
import type { QuoteWaiting } from "@/components/v2/client/approvals/quote-decision-card";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Approvals · Estate client" };
export const dynamic = "force-dynamic";

/**
 * Approvals (board 3). Account holder only, as before: assistants never decide
 * money. Quotes waiting for a decision are listed here too ("say yes before you
 * are charged"); they are read from the client's own quotes and decided in the
 * existing My quotes flow.
 */
export default async function ClientApprovalsPage({ searchParams }: { searchParams?: { view?: string } } = {}) {
  await ensureClientModuleAccess("approvals");
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id).catch(() => null);
  const quotes: QuoteWaiting[] | null = portal?.clientId
    ? await listQuotesWaiting(portal.clientId).catch(() => null)
    : null;
  const view: ApprovalsView = searchParams?.view === "history" ? "history" : "waiting";

  return (
    <div className="space-y-4">
      <EPageHeader
        title="Approvals"
        description="Optional extras and quotes waiting for your decision, and what you decided before."
      />
      <ClientApprovalsBoard view={view} quotes={quotes} />
    </div>
  );
}
