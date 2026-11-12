import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import {
  decideEarlyCheckoutRequest,
  listEarlyCheckoutRequests,
} from "@/lib/jobs/early-checkout-requests";

const schema = z.object({
  decision: z.enum(["APPROVE", "DECLINE"]).default("APPROVE"),
  note: z.string().trim().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const request = (await listEarlyCheckoutRequests()).find((row) => row.id === params.id);
    if (!request) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const assignment = await db.jobAssignment.findFirst({
      where: {
        jobId: request.jobId,
        userId: session.user.id,
        removedAt: null,
      },
    });
    if (!assignment || assignment.removedAt) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    const updated = await decideEarlyCheckoutRequest({
      id: params.id,
      decidedById: session.user.id,
      decision: body.decision,
      decisionNote: body.note,
    });

    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
    });
    if (admins.length > 0) {
      const reviewed = (await loadNotificationWording("job.cleaner_requests_decided")).render("timing-reviewed", "INBOX", {
        cleanerName: session.user.name ?? session.user.email ?? "Cleaner",
        decision: body.decision === "APPROVE" ? "approved" : "declined",
        jobId: request.jobId,
      });
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          jobId: request.jobId,
          externalId: mobilePendingMarker("approvals"),
          channel: NotificationChannel.PUSH,
          subject: reviewed.title,
          body: reviewed.body,
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
