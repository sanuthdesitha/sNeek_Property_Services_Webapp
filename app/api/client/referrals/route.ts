import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getClientRewardsSummary, createReferralInvite } from "@/lib/client/rewards";
import { resolveAppUrl } from "@/lib/app-url";

const schema = z.object({
  refereeEmail: z.string().trim().email(),
});

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        clientId: true,
      },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    return NextResponse.json(await getClientRewardsSummary(user.clientId));
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load referrals." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        clientId: true,
        client: {
          select: {
            name: true,
          },
        },
      },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }

    const invite = await createReferralInvite({
      clientId: user.clientId,
      clientName: user.client?.name || session.user.name || "sNeek Client",
      refereeEmail: body.refereeEmail,
    });

    return NextResponse.json({
      invite,
      shareUrl: resolveAppUrl(`/register?ref=${encodeURIComponent(invite.code)}`, req),
    });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not create referral invite." }, { status });
  }
}
