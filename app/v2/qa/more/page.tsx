import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QaMoreMenu } from "@/components/v2/qa/portal/qa-more-menu";

export const metadata = { title: "More · Estate QA" };
export const dynamic = "force-dynamic";

/**
 * The More tab (approved QA board, 2026-11). This URL redirected to Today while
 * the portal had no More menu; it is the menu again, so old bookmarks land on
 * the labelled list of every destination that is not a daily tab.
 */
export default async function V2QaMorePage() {
  const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const office = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <EPageHeader title="More" description="Stats, invoices, your profile and account." />
      <QaMoreMenu office={office} />
    </div>
  );
}
