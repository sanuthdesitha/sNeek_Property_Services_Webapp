import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AssignedMaintenanceSection } from "@/components/v2/portal/assigned-maintenance-section";

export const metadata = { title: "Maintenance · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * CP-6 — the cleaner's maintenance section. The nav entry only exists while
 * they hold an assignment, but the route itself is reachable by URL, so the
 * page still renders its own empty state rather than pretending to 404.
 */
export default async function V2CleanerMaintenancePage() {
  const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <AssignedMaintenanceSection
      userId={session.user.id}
      eyebrow="CLEANER · MAINTENANCE"
      intro="These are maintenance items you have personally been assigned to as the cleaner. A maintenance worker and a QA inspector may be on the same item — check with them before attending."
    />
  );
}
