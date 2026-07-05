import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QueueBoard } from "@/components/v2/laundry/laundry-board";

export const metadata = { title: "Queue · Estate laundry" };
export const dynamic = "force-dynamic";

// Live queue — reads the SAME /api/laundry/week feed the v1 workspace uses and
// groups by the real LaundryStatus, so stages are always accurate.
export default async function LaundryQueuePage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Board" title="Queue" description="Every active set, by stage." />
      <QueueBoard />
    </div>
  );
}
