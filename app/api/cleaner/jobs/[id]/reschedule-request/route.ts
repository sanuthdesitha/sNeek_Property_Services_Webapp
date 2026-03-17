import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createContinuationRequest, listContinuationRequests } from "@/lib/jobs/continuation-requests";

const schema = z.object({
  reason: z.string().trim().min(5).max(2000),
  preferredDate: z.string().date().optional().nullable(),
  estimatedRemainingHours: z.number().positive().max(24).optional().nullable(),
  progressSnapshot: z
    .object({
      formData: z.record(z.unknown()).optional(),
      uploads: z.record(z.array(z.string().min(1))).optional(),
      laundryReady: z.boolean().optional(),
      bagLocation: z.string().trim().max(400).optional().nullable(),
      resolvedCarryForwardIds: z.array(z.string().trim().min(1)).optional(),
      hasMissedTask: z.boolean().optional(),
      missedTaskNotes: z.array(z.string().trim().max(2000)).optional(),
    })
    .optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const rows = await listContinuationRequests({
      jobId: params.id,
      requestedByUserId: session.user.id,
    });
    return NextResponse.json(rows);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load requests." }, { status });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: params.id, userId: session.user.id, removedAt: null },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "You are not assigned to this job." }, { status: 403 });
    }

    const openLogs = await db.timeLog.findMany({
      where: {
        jobId: params.id,
        userId: session.user.id,
        stoppedAt: null,
      },
      select: { id: true, startedAt: true },
    });
    let autoPausedMinutes = 0;
    if (openLogs.length > 0) {
      const now = new Date();
      for (const row of openLogs) {
        const durationM = Math.max(0, Math.round((now.getTime() - row.startedAt.getTime()) / 60_000));
        autoPausedMinutes += durationM;
        await db.timeLog.update({
          where: { id: row.id },
          data: { stoppedAt: now, durationM },
        });
      }
    }

    const created = await createContinuationRequest({
      jobId: params.id,
      requestedByUserId: session.user.id,
      reason: body.reason,
      preferredDate: body.preferredDate ?? null,
      estimatedRemainingHours: body.estimatedRemainingHours ?? null,
      progressSnapshot: body.progressSnapshot
        ? {
            formData: body.progressSnapshot.formData ?? {},
            uploads: body.progressSnapshot.uploads ?? {},
            laundryReady: body.progressSnapshot.laundryReady === true,
            bagLocation: body.progressSnapshot.bagLocation?.trim() || null,
            resolvedCarryForwardIds: body.progressSnapshot.resolvedCarryForwardIds ?? [],
            hasMissedTask: body.progressSnapshot.hasMissedTask === true,
            missedTaskNotes: body.progressSnapshot.missedTaskNotes ?? [],
            capturedAt: new Date().toISOString(),
          }
        : null,
    });

    const admins = await db.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.OPS_MANAGER] },
        isActive: true,
      },
      select: { id: true },
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          jobId: params.id,
          channel: NotificationChannel.PUSH,
          subject: "Continuation request pending",
          body: `Job ${params.id} requires continuation approval.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }

    return NextResponse.json({ ...created, timerAutoPaused: openLogs.length > 0, autoPausedMinutes }, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create continuation request." }, { status });
  }
}
