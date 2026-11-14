import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadWorkforceAreaSummary } from "@/lib/workforce/area-counts";
import { WorkforceArea } from "@/components/v2/admin/workforce/workforce-area";
import { CoachingWorkspace } from "@/components/v2/admin/workforce/coaching-workspace";

export const metadata = { title: "Coaching · Workforce" };
export const dynamic = "force-dynamic";

/**
 * Workforce › Coaching: coaching notes, warnings and management reviews; the
 * cleaner sees the reason and acknowledges it. Suspended and Terminated are
 * administrator-only with a PIN confirmation (enforced by the route).
 */
export default async function V2AdminCoachingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const summary = await loadWorkforceAreaSummary();
  return (
    <WorkforceArea active="coaching" summary={summary}>
      <CoachingWorkspace />
    </WorkforceArea>
  );
}
