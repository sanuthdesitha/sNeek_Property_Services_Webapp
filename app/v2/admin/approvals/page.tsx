import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
// Estate-native approval centre: one /api/admin/all-approvals fetch feeds all
// nine queues (continuations, timing, pay requests, clock adjustments, client
// approvals, flagged laundry, reschedules, QA reworks, skip requests) with
// native Approve/Decline wired to the same v1 mutation endpoints.
import { ApprovalsWorkspace } from "@/components/v2/admin/approvals/approvals-workspace";

export const metadata = { title: "Approvals · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminApprovalsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <ApprovalsWorkspace />;
}
