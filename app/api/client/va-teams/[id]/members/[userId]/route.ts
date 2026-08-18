import { NextResponse } from "next/server";
import { requireClientPortal, auditClientPortalAction } from "@/lib/auth/client-portal";
import { assertTeamManager, removeVaMember } from "@/lib/va/teams";
import { vaTeamErrorStatus } from "@/lib/va/http";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const { id, userId } = params;
    const portal = await requireClientPortal();
    assertTeamManager(portal);

    const result = await removeVaMember({ clientId: portal.clientId, teamId: id, userId });

    await auditClientPortalAction({
      ctx: portal,
      action: "va_team.member_remove",
      entity: "VaTeam",
      entityId: id,
      after: { removedUserId: result.removed },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not remove the member." }, { status: vaTeamErrorStatus(err) });
  }
}
