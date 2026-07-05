import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
// The legacy approvals page is a self-contained "use client" workspace — all
// queues (continuations, timing, pay requests via PayRequestsWorkspace, clock
// adjustments via ClockAdjustmentsWorkspace, client approvals, flagged
// laundry, reschedules, QA reworks, skip requests) with every approve /
// decline / send-to-client mutation. Mount it directly; never fork it.
import ApprovalsWorkspace from "@/app/admin/approvals/page";

export const metadata = { title: "Approvals · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminApprovalsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <ApprovalsWorkspace />;
}
