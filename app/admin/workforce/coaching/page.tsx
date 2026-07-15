import { Role } from "@prisma/client";
import { GraduationCap } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { CoachingWorkspace } from "@/components/admin/coaching-workspace";

export const dynamic = "force-dynamic";

export default async function AdminCoachingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<GraduationCap />}
        title="Coaching & accountability"
        description="Coaching notes, warnings, and management reviews — recommendations authored by managers, acknowledged by cleaners."
      />
      <CoachingWorkspace />
    </div>
  );
}
