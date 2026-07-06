import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { TeamHub } from "@/components/v2/cleaner/team-hub";

export const metadata = { title: "Team hub · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Native Estate cleaner team hub. Same auth as the legacy `app/cleaner/hub`
 * route; the mounted TeamHub client component reads the SAME
 * `GET /api/me/workforce` overview endpoint and renders the feed, recognition
 * wall, and leaderboards natively in Estate — no v1 workforce / UI imports.
 */
export default async function V2CleanerHubPage() {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Team hub"
        description="Team feed, recognition, and leaderboards."
      />
      <TeamHub />
    </div>
  );
}
