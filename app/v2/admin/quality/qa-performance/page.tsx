import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QaPerformanceDashboard } from "@/components/v2/admin/quality/qa-performance-dashboard";

export const metadata = { title: "QA Performance · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminQaPerformancePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality"
        title="QA Performance"
        description="Per-inspector accountability — inspections, issues found and fixed, rectification cost, and missed-issue caution signals."
      />
      <QaPerformanceDashboard />
    </div>
  );
}
