import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { Trophy } from "lucide-react";
import { AccountabilityDashboard } from "@/components/admin/accountability-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminAccountabilityPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Trophy />}
        title="Accountability"
        description="Per-cleaner quality accountability — scores, ratings, streaks, issues, coaching and bonus proposals."
      />
      <AccountabilityDashboard />
    </div>
  );
}
