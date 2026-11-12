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
const HUB_TABS = ["feed", "chat", "learning", "documents", "recognition", "leaderboard"] as const;
type HubTabKey = (typeof HUB_TABS)[number];

function hubTab(value: string | string[] | undefined): HubTabKey | undefined {
  return typeof value === "string" && (HUB_TABS as readonly string[]).includes(value) ? (value as HubTabKey) : undefined;
}

export default async function V2CleanerHubPage({ searchParams }: { searchParams?: { tab?: string | string[] } } = {}) {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Team hub"
        description="Team feed, recognition, and leaderboards."
      />
      <TeamHub initialTab={hubTab(searchParams?.tab)} />
    </div>
  );
}
