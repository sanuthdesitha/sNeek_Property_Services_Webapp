import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { StaffWorkforceHub } from "@/components/workforce/staff-workforce-hub";

export const metadata = { title: "Team hub · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Estate wrapper for the cleaner team hub. Same auth as the legacy
 * `app/cleaner/hub` route. The mounted `StaffWorkforceHub` client component owns
 * the live workforce feed/chat/recognition data + actions via its own endpoints.
 */
export default async function V2CleanerHubPage() {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Team hub"
        description="Team feed, chat, and recognition."
      />
      <StaffWorkforceHub title="Cleaner Team Hub" />
    </div>
  );
}
