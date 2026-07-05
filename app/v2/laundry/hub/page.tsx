import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { LaundryTeamHub } from "@/components/v2/laundry/laundry-team-hub";

export const metadata = { title: "Team hub · Estate laundry" };
export const dynamic = "force-dynamic";

// Native Estate team hub — feed / recognition / leaderboards over the SAME
// /api/me/workforce endpoint the v1 hub uses. No v1 workforce / UI imports.
export default async function LaundryHubPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Team hub"
        description="Announcements, recognition and leaderboards for the Estate team."
      />
      <LaundryTeamHub />
    </div>
  );
}
