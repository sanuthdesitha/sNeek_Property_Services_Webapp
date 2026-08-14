import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AssignedMaintenanceSection } from "@/components/v2/portal/assigned-maintenance-section";

export const metadata = { title: "Maintenance · Estate QA" };
export const dynamic = "force-dynamic";

/**
 * CP-6 — the QA inspector's maintenance section. The nav entry only exists
 * while they hold an assignment, but the route itself is reachable by URL, so
 * the page still renders its own empty state rather than pretending to 404.
 */
export default async function V2QaMaintenancePage() {
  const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <AssignedMaintenanceSection
      userId={session.user.id}
      eyebrow="QA · MAINTENANCE"
      intro="These are maintenance items you have personally been assigned to as the QA inspector. A maintenance worker and a cleaner may be on the same item — sign off only once their work is done."
    />
  );
}
