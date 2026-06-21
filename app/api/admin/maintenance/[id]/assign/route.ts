import { NextRequest, NextResponse } from "next/server";
import { Role, NotificationChannel, NotificationStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assignMaintenanceItem } from "@/lib/maintenance/workers";

const schema = z.object({
  workerId: z.string().min(1),
  scheduledFor: z.string().datetime().nullable().optional(),
  shareAccess: z.boolean().optional(),
  contactPersonUserId: z.string().min(1).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    const item = await assignMaintenanceItem({
      itemId: params.id,
      workerId: body.workerId,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      shareAccess: body.shareAccess ?? false,
      contactPersonUserId: body.contactPersonUserId ?? null,
      assignedByUserId: session.user.id,
    });

    // Notify the worker (if they have a portal login).
    const worker = await db.maintenanceWorker.findUnique({
      where: { id: body.workerId },
      select: { userId: true, name: true },
    });
    if (worker?.userId) {
      const detail = await db.propertyMaintenanceItem.findUnique({
        where: { id: params.id },
        select: { title: true, property: { select: { name: true } } },
      });
      await db.notification.create({
        data: {
          userId: worker.userId,
          channel: NotificationChannel.PUSH,
          subject: "New maintenance job assigned",
          body: `${detail?.property?.name ?? "A property"}: ${detail?.title ?? "Repair job"}`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    return NextResponse.json({ ok: true, item });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
