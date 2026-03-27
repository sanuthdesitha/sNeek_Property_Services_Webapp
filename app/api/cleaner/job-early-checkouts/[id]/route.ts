import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  acknowledgeEarlyCheckoutRequest,
  listEarlyCheckoutRequests,
} from "@/lib/jobs/early-checkout-requests";

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const request = (await listEarlyCheckoutRequests()).find((row) => row.id === params.id);
    if (!request) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const assignment = await db.jobAssignment.findUnique({
      where: { jobId_userId: { jobId: request.jobId, userId: session.user.id } },
    });
    if (!assignment || assignment.removedAt) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    const updated = await acknowledgeEarlyCheckoutRequest({
      id: params.id,
      acknowledgedById: session.user.id,
    });

    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          jobId: request.jobId,
          channel: NotificationChannel.PUSH,
          subject: "Early checkout update acknowledged",
          body: `${session.user.name ?? session.user.email ?? "Cleaner"} acknowledged the early checkout update for job ${request.jobId}.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update request." }, { status });
  }
}
