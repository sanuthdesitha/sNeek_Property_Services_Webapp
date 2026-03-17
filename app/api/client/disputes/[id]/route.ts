import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getDisputeById, patchDispute } from "@/lib/phase4/disputes";

const schema = z.object({
  comment: z.string().trim().min(1).max(2000).optional(),
  status: z.enum(["OPEN"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    const current = await getDisputeById(params.id);
    if (!current || current.clientId !== user.clientId) {
      return NextResponse.json({ error: "Dispute not found." }, { status: 404 });
    }
    const body = schema.parse(await req.json().catch(() => ({})));
    const updated = await patchDispute(params.id, {
      status: body.status ?? undefined,
      addComment: body.comment
        ? {
            authorUserId: session.user.id,
            body: body.comment,
          }
        : null,
    });
    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
      take: 50,
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          jobId: updated?.jobId ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: "Client dispute updated",
          body: `${current.title}${body.comment ? " - new client comment" : ""}`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update dispute." }, { status });
  }
}
