import { NextRequest, NextResponse } from "next/server";
import { Role, MaintenanceOutcome, NotificationChannel, NotificationStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getWorkerForUser, setMaintenanceVisitState, userIsAssignedWorker } from "@/lib/maintenance/workers";

const schema = z.object({
  event: z.enum(["EN_ROUTE", "ARRIVED", "CLOCK_IN", "START", "CLOCK_OUT", "COMPLETE"]),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
  outcome: z.nativeEnum(MaintenanceOutcome).nullable().optional(),
  workerNote: z.string().trim().max(4000).nullable().optional(),
  issuesNote: z.string().trim().max(4000).nullable().optional(),
  finishPhotoKeys: z.array(z.string().trim().min(1)).max(40).nullable().optional(),
});

/**
 * A maintenance worker advances their visit (en route → arrived → clock in →
 * complete). Admin/ops can also drive it. On each step the contact person +
 * admins are notified so everyone can follow the visit.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
    const isAdmin = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
    if (!isAdmin && !(await userIsAssignedWorker(session.user.id, params.id))) {
      return NextResponse.json({ error: "Not your maintenance job." }, { status: 403 });
    }
    const body = schema.parse(await req.json());
    const worker = await getWorkerForUser(session.user.id);

    const item = await setMaintenanceVisitState({
      itemId: params.id,
      workerId: worker?.id ?? null,
      event: body.event,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      accuracy: body.accuracy ?? null,
      outcome: body.outcome ?? null,
      workerNote: body.workerNote ?? null,
      issuesNote: body.issuesNote ?? null,
      finishPhotoKeys: body.finishPhotoKeys ?? null,
      userId: session.user.id,
    });

    // Keep the contact person + admins/ops in the loop on every transition.
    try {
      const detail = await db.propertyMaintenanceItem.findUnique({
        where: { id: params.id },
        select: {
          title: true,
          contactPersonUserId: true,
          property: { select: { name: true } },
          assignedWorker: { select: { name: true } },
        },
      });
      const recipients = new Set<string>();
      if (detail?.contactPersonUserId) recipients.add(detail.contactPersonUserId);
      const admins = await db.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
        select: { id: true },
      });
      admins.forEach((a) => recipients.add(a.id));
      const label = body.event.replace(/_/g, " ").toLowerCase();
      if (recipients.size > 0) {
        await db.notification.createMany({
          data: Array.from(recipients).map((userId) => ({
            userId,
            channel: NotificationChannel.PUSH,
            subject: `Maintenance: ${label}`,
            body: `${detail?.assignedWorker?.name ?? "Worker"} — ${detail?.property?.name ?? "property"}: ${detail?.title ?? "job"}${body.event === "COMPLETE" && body.outcome ? ` (${body.outcome.replace(/_/g, " ").toLowerCase()})` : ""}`,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
        });
      }
    } catch {
      // best-effort
    }

    return NextResponse.json({ ok: true, item });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
