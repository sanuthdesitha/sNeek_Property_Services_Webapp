import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { TrackingBoard } from "@/components/v2/laundry/laundry-board";

export const metadata = { title: "Tracking · Estate laundry" };
export const dynamic = "force-dynamic";

// Live per-set tracking: a status timeline (Confirmed → Picked up → Returned)
// plus inline update actions, all wired to /api/laundry/[taskId]/status.
export default async function LaundryTrackingPage() {
  const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  // Deleting a set is an admin/ops action. Laundry accounts keep the existing
  // "Failed pickup → request skip/delete approval" path (the API refuses them too).
  const canDelete = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Live"
        title="Tracking"
        description="Follow every set from pickup to return, and move it along."
      />
      <TrackingBoard canDelete={canDelete} />
    </div>
  );
}
