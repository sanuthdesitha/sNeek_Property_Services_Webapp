import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native reports manager — same /api/admin/reports endpoints as v1
// (search, filters, pagination, visibility toggles, regenerate, PDF, delete)
// rendered entirely with Estate primitives.
import { ReportsManager } from "@/components/v2/admin/reports/reports-manager";

export const metadata = { title: "Reports · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminReportsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality"
        title="Reports"
        description="Generated service reports — control who sees them, re-export, and archive."
      />
      <ReportsManager />
    </div>
  );
}
