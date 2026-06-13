import { Role } from "@prisma/client";
import { Users } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { AdminWorkforceHub } from "@/components/workforce/admin-workforce-hub";
import { PerformanceLeaderboard } from "@/components/workforce/performance-leaderboard";
import { WorkforceTopNav } from "@/components/workforce/workforce-top-nav";
import { getAppBaseUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

export default async function AdminWorkforcePage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  // Union of both legacy gates: workforce roster was ADMIN/OPS_MANAGER, the
  // performance leaderboard also allowed QA_INSPECTOR.
  const session = await requireRole([
    Role.ADMIN,
    Role.OPS_MANAGER,
    Role.QA_INSPECTOR,
  ]);
  const isQaOnly = session.user.role === Role.QA_INSPECTOR;

  // QA inspectors never had access to the workforce roster — keep them on the
  // Performance tab regardless of the requested tab.
  const tab = isQaOnly
    ? "performance"
    : searchParams.tab === "performance"
      ? "performance"
      : "team";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users />}
        title="Workforce"
        description="Team roster, groups, hiring, and cleaner performance — all in one place."
      />

      <WorkforceTopNav active={tab} />

      {tab === "performance" ? (
        <PerformanceLeaderboard />
      ) : (
        <AdminWorkforceHub appBaseUrl={getAppBaseUrl() ?? ""} embedded />
      )}
    </div>
  );
}
