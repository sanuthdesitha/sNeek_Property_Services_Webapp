import { NextResponse } from "next/server";
import { requireClientPortal, auditClientPortalAction } from "@/lib/auth/client-portal";
import { assertTeamManager, inviteVaMember, vaMemberInviteSchema } from "@/lib/va/teams";
import { vaTeamErrorStatus } from "@/lib/va/http";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const portal = await requireClientPortal();
    assertTeamManager(portal);

    const parsed = vaMemberInviteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid invite." }, { status: 400 });
    }

    const result = await inviteVaMember({
      clientId: portal.clientId,
      teamId: id,
      email: parsed.data.email,
      name: parsed.data.name,
      invitedById: portal.userId,
    });

    await auditClientPortalAction({
      ctx: portal,
      action: "va_team.invite",
      entity: "VaTeam",
      entityId: id,
      after: { invitedUserId: result.userId, email: result.email, emailSent: result.emailSent },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not send the invitation." }, { status: vaTeamErrorStatus(err) });
  }
}
