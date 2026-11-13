import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { RulesWorkspace } from "@/components/v2/admin/settings/scheduling-rules/rules-workspace";

export const metadata = { title: "Scheduling rules · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Settings › Operations › Scheduling rules. ADMIN and OPS_MANAGER may view;
 * changing needs ADMIN (or the scheduling.rules_edit grant) and the person's
 * own PIN. Every API call re-checks on the server.
 */
export default async function SchedulingRulesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-5">
      <EPageHeader
        eyebrow="Settings · Operations"
        title="Scheduling rules"
        description="How laundry runs and jobs are planned automatically, in plain words. Locked; every change is a new version you can compare, undo or restore."
        actions={<EButton asChild variant="outline"><a href="/v2/admin/settings?tab=laundry">Back to settings</a></EButton>}
      />
      <RulesWorkspace />
    </div>
  );
}
