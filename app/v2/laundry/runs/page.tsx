import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { RunsBoard } from "@/components/v2/laundry/laundry-board";

export const metadata = { title: "Runs · Estate laundry" };
export const dynamic = "force-dynamic";

// Today's pickup + drop-off loops with accurate done/total counts, driven by the
// real /api/laundry/week feed and the /api/laundry/[taskId]/status endpoint.
export default async function LaundryRunsPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Dispatch" title="Runs" description="Today's pickup and drop-off loops. Confirm as you go." />
      <RunsBoard />
    </div>
  );
}
