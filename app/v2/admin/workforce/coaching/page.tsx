import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CoachingWorkspace } from "@/components/v2/admin/workforce/coaching-workspace";

export const metadata = { title: "Coaching · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminCoachingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Coaching & accountability"
        description="Coaching notes, warnings, and management reviews — recommendations authored by managers, acknowledged by cleaners."
      />
      <CoachingWorkspace />
    </div>
  );
}
