import { NextRequest, NextResponse } from "next/server";
import { MediaOverrideStatus, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

const schema = z.object({
  status: z.nativeEnum(MediaOverrideStatus),
  decisionNote: z.string().trim().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    if (
      body.status !== MediaOverrideStatus.APPROVED &&
      body.status !== MediaOverrideStatus.DECLINED &&
      body.status !== MediaOverrideStatus.RESOLVED
    ) {
      return NextResponse.json({ error: "Invalid override decision." }, { status: 400 });
    }
    const before = await db.mediaOverrideRequest.findUnique({ where: { id: params.id } });
    if (!before) return NextResponse.json({ error: "Override request not found." }, { status: 404 });
    const updated = await db.mediaOverrideRequest.update({
      where: { id: params.id },
      data: {
        status: body.status,
        decisionNote: body.decisionNote || null,
        decidedById: session.user.id,
        decidedAt: new Date(),
      },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MEDIA_OVERRIDE_DECISION",
        entity: "MediaOverrideRequest",
        entityId: updated.id,
        before: before as any,
        after: updated as any,
      },
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
