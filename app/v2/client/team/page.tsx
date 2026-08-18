import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { VaTeamManager, type VaTeamView } from "@/components/v2/client/va-team-manager";
import { parseVaPermissions, parseVaPropertyScope } from "@/lib/va/permissions";
import { listVaTeams } from "@/lib/va/teams";

export const metadata = { title: "Assistants · Estate client" };
export const dynamic = "force-dynamic";

/**
 * Managing assistants is the client's alone — requireRole([Role.CLIENT]) here
 * mirrors `assertTeamManager` on the API, so a VA who guesses the URL is
 * bounced by the page as well as by every endpoint behind it.
 */
export default async function ClientTeamPage() {
  const session = await requireRole([Role.CLIENT]);

  const user = await db.user
    .findUnique({ where: { id: session.user.id }, select: { clientId: true } })
    .catch(() => null);

  if (!user?.clientId) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <EPageHeader
          eyebrow="Account"
          title="Assistants"
          description="Your client profile is still being set up. Assistants can be added once it is ready."
        />
      </div>
    );
  }

  const [rawTeams, properties] = await Promise.all([
    listVaTeams(user.clientId),
    db.property.findMany({
      where: { clientId: user.clientId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Dates cross the server/client boundary as ISO strings, and the two Json
  // columns go through the same parsers the auth chokepoint uses — so the UI
  // renders exactly the grant that would be enforced, never a looser reading.
  const teams: VaTeamView[] = rawTeams.map((team) => ({
    id: team.id,
    name: team.name,
    isActive: team.isActive,
    permissions: parseVaPermissions(team.permissions),
    propertyIds: parseVaPropertyScope(team.propertyIds),
    members: team.members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      isActive: m.isActive,
      invitation: m.invitation
        ? {
            acceptedAt: m.invitation.acceptedAt?.toISOString() ?? null,
            expiresAt: m.invitation.expiresAt.toISOString(),
          }
        : null,
    })),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Assistants"
        description="Give a virtual assistant their own login, scoped to the properties and actions you choose. They can never approve spending or pay an invoice."
      />
      <VaTeamManager initialTeams={teams} properties={properties} />
    </div>
  );
}
