import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QueueBoard } from "@/components/v2/laundry/laundry-board";

export const metadata = { title: "Queue · Estate laundry" };
export const dynamic = "force-dynamic";

// Live queue — reads the SAME /api/laundry/week feed the v1 workspace uses and
// groups by the real LaundryStatus, so stages are always accurate.
export default async function LaundryQueuePage() {
  const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  // Deleting a set is an admin/ops action. Laundry accounts keep the existing
  // "Failed pickup → request skip/delete approval" path (the API refuses them too).
  const canDelete = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Board" title="Queue" description="Every active set, by stage." />
      <QueueBoard canDelete={canDelete} />
    </div>
  );
}
