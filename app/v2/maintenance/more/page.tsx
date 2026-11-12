import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { MaintenanceMoreMenu } from "@/components/v2/maintenance/portal/maintenance-more-menu";

export const metadata = { title: "More · Estate maintenance" };
export const dynamic = "force-dynamic";

/**
 * The More tab (approved maintenance board, 2026-11). This URL redirected to
 * Today while the portal had no More menu; it is the menu again.
 */
export default async function V2MaintenanceMorePage() {
  const session = await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
  const office = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <EPageHeader title="More" description="Your completed log, settings and account." />
      <MaintenanceMoreMenu office={office} />
    </div>
  );
}
