import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { HistoryBoard } from "@/components/v2/laundry/history-board";

export const metadata = { title: "History · Estate laundry" };
export const dynamic = "force-dynamic";

export default async function LaundryHistoryPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Laundry operations"
        title="History"
        description="Past laundry pickups and deliveries — search, filter, and review by day."
      />
      <HistoryBoard />
    </div>
  );
}
