import { NextResponse } from "next/server";
import { requireClientPortal, auditClientPortalAction } from "@/lib/auth/client-portal";
import { assertTeamManager, updateVaTeam, deleteVaTeam, vaTeamUpdateSchema } from "@/lib/va/teams";
import { vaTeamErrorStatus } from "@/lib/va/http";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const portal = await requireClientPortal();
    assertTeamManager(portal);

    const parsed = vaTeamUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change." }, { status: 400 });
    }

    const team = await updateVaTeam({ clientId: portal.clientId, teamId: id, ...parsed.data });

    await auditClientPortalAction({
      ctx: portal,
      action: "va_team.update",
      entity: "VaTeam",
      entityId: id,
      after: { ...parsed.data },
    });

    return NextResponse.json(team);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update the team." }, { status: vaTeamErrorStatus(err) });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const portal = await requireClientPortal();
    assertTeamManager(portal);

    await deleteVaTeam({ clientId: portal.clientId, teamId: id });

    await auditClientPortalAction({
      ctx: portal,
      action: "va_team.delete",
      entity: "VaTeam",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not remove the team." }, { status: vaTeamErrorStatus(err) });
  }
}
