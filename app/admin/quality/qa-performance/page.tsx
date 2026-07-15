import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { Activity } from "lucide-react";
import { QaPerformanceDashboard } from "@/components/admin/qa-performance-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminQaPerformancePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Activity />}
        title="QA Performance"
        description="Per-inspector accountability — inspections, issues found and fixed, rectification cost, and missed-issue caution signals."
      />
      <QaPerformanceDashboard />
    </div>
  );
}
