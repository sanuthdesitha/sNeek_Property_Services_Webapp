import { NextResponse } from "next/server";
import { requireClientPortal, auditClientPortalAction } from "@/lib/auth/client-portal";
import { assertTeamManager, listVaTeams, createVaTeam, vaTeamCreateSchema } from "@/lib/va/teams";
import { vaTeamErrorStatus } from "@/lib/va/http";

export async function GET() {
  try {
    const portal = await requireClientPortal();
    assertTeamManager(portal);
    return NextResponse.json(await listVaTeams(portal.clientId));
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load teams." }, { status: vaTeamErrorStatus(err) });
  }
}

export async function POST(req: Request) {
  try {
    const portal = await requireClientPortal();
    assertTeamManager(portal);

    const parsed = vaTeamCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid team." }, { status: 400 });
    }

    const team = await createVaTeam({
      clientId: portal.clientId,
      createdById: portal.userId,
      name: parsed.data.name,
      permissions: parsed.data.permissions,
      propertyIds: parsed.data.propertyIds,
    });

    await auditClientPortalAction({
      ctx: portal,
      action: "va_team.create",
      entity: "VaTeam",
      entityId: team.id,
      after: { name: team.name, permissions: team.permissions, propertyIds: team.propertyIds },
    });

    return NextResponse.json(team, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not create the team." }, { status: vaTeamErrorStatus(err) });
  }
}
