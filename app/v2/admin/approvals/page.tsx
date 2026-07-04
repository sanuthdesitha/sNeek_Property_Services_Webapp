import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ApprovalsSummary } from "@/components/v2/admin/approvals-summary";

export const metadata = { title: "Approvals · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminApprovalsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  // Reuses the exact legacy data source (/api/admin/all-approvals). The Estate
  // client renders a per-category summary; the full actionable workspace
  // (approve/decline/send-to-client mutations) opens on the live /admin/approvals.
  return <ApprovalsSummary />;
}
