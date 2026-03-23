import { NextRequest, NextResponse } from "next/server";
import { LaundryStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { LAUNDRY_SKIP_REASONS } from "@/lib/laundry/constants";

const updateLaundryTaskSchema = z.object({
  pickupDate: z.string().datetime().optional(),
  dropoffDate: z.string().datetime().optional(),
  status: z.nativeEnum(LaundryStatus).optional(),
  flagNotes: z.string().trim().optional().nullable(),
  skipReasonCode: z
    .enum(LAUNDRY_SKIP_REASONS.map((row) => row.value) as [string, ...string[]])
    .optional()
    .nullable(),
  skipReasonNote: z.string().trim().max(2000).optional().nullable(),
  adminOverrideNote: z.string().trim().max(2000).optional().nullable(),
  action: z.enum(["APPROVE_FAILED_PICKUP_SKIP", "APPROVE_FAILED_PICKUP_DELETE", "REJECT_FAILED_PICKUP_REQUEST"]).optional(),
  resolutionNotes: z.string().trim().max(2000).optional().nullable(),
});

function parseNotesJson(notes: string | null | undefined) {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function createRoleNotifications(roles: Role[], subject: string, body: string, jobId?: string | null) {
  const recipients = await db.user.findMany({
    where: {
      role: { in: roles },
      isActive: true,
    },
    select: { id: true },
  });

  if (!recipients.length) return;

  await db.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      jobId: jobId ?? null,
      channel: "PUSH",
      subject,
      body,
      status: "SENT",
      sentAt: new Date(),
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateLaundryTaskSchema.parse(await req.json());
    if (body.action) {
      const task = await db.laundryTask.findUnique({
        where: { id: params.taskId },
        include: {
          property: { select: { name: true, suburb: true } },
          confirmations: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!task) {
        return NextResponse.json({ error: "Laundry task not found." }, { status: 404 });
      }

      const requestConfirmation = [...task.confirmations].reverse().find((row) => {
        const meta = parseNotesJson(row.notes);
        return meta.event === "FAILED_PICKUP_REQUEST" && meta.approvalStatus === "PENDING";
      });
      if (!requestConfirmation) {
        return NextResponse.json({ error: "No pending failed pickup approval request found." }, { status: 409 });
      }

      const requestMeta = parseNotesJson(requestConfirmation.notes) as Record<string, unknown>;
      const decisionAction = body.action;
      const requestAction = String(requestMeta.requestedAction ?? "SKIP");
      const reason = typeof requestMeta.reason === "string" ? requestMeta.reason : "";
      const previousStatus = typeof requestMeta.previousStatus === "string" ? requestMeta.previousStatus : "CONFIRMED";
      const resolutionNotes = body.resolutionNotes?.trim() || null;

      if (decisionAction === "APPROVE_FAILED_PICKUP_DELETE") {
        if (requestAction !== "DELETE") {
          return NextResponse.json({ error: "This request is not waiting for delete approval." }, { status: 409 });
        }

        await db.$transaction(async (tx) => {
          await tx.auditLog.create({
            data: {
              userId: session.user.id,
              jobId: task.jobId,
              action: "LAUNDRY_FAILED_PICKUP_DELETE_APPROVED",
              entity: "LaundryTask",
              entityId: task.id,
              before: {
                status: task.status,
                requestedAction: requestAction,
                reason,
              },
              after: {
                deleted: true,
                resolutionNotes,
              },
            },
          });
          await tx.laundryConfirmation.deleteMany({ where: { laundryTaskId: task.id } });
          await tx.laundryTask.delete({ where: { id: task.id } });
        });

        await createRoleNotifications(
          [Role.LAUNDRY],
          "Laundry delete approved",
          `${task.property.name}: failed pickup delete request approved.${resolutionNotes ? ` ${resolutionNotes}` : ""}`,
          task.jobId
        );

        return NextResponse.json({ ok: true, deleted: true });
      }

      const confirmationEvent =
        decisionAction === "APPROVE_FAILED_PICKUP_SKIP" ? "FAILED_PICKUP_SKIP_APPROVED" : "FAILED_PICKUP_REQUEST_REJECTED";
      const nextStatus = decisionAction === "APPROVE_FAILED_PICKUP_SKIP" ? "FLAGGED" : previousStatus;
      const nextFlagNotes =
        decisionAction === "APPROVE_FAILED_PICKUP_SKIP"
          ? `Failed pickup approved to skip.${reason ? ` Reason: ${reason}` : ""}`
          : null;

      if (decisionAction === "APPROVE_FAILED_PICKUP_SKIP" && requestAction !== "SKIP") {
        return NextResponse.json({ error: "This request is not waiting for skip approval." }, { status: 409 });
      }

      const updated = await db.$transaction(async (tx) => {
        const updatedTask = await tx.laundryTask.update({
          where: { id: task.id },
          data: {
            status: nextStatus as LaundryStatus,
            flagNotes: nextFlagNotes,
            ...(decisionAction === "APPROVE_FAILED_PICKUP_SKIP" ? { notifyLaundry: false } : {}),
          },
          include: {
            property: { select: { name: true, suburb: true } },
            job: { select: { scheduledDate: true } },
          },
        });

        await tx.laundryConfirmation.create({
          data: {
            laundryTaskId: task.id,
            confirmedById: session.user.id,
            laundryReady: true,
            notes: JSON.stringify({
              event: confirmationEvent,
              requestedAction: requestAction,
              reason,
              resolutionNotes,
            }),
          },
        });

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            jobId: task.jobId,
            action: decisionAction,
            entity: "LaundryTask",
            entityId: task.id,
            before: {
              status: task.status,
              flagNotes: task.flagNotes,
              requestedAction: requestAction,
              reason,
            },
            after: {
              status: nextStatus,
              flagNotes: nextFlagNotes,
              resolutionNotes,
            },
          },
        });

        return updatedTask;
      });

      await createRoleNotifications(
        [Role.LAUNDRY],
        decisionAction === "APPROVE_FAILED_PICKUP_SKIP" ? "Laundry skip approved" : "Laundry request rejected",
        decisionAction === "APPROVE_FAILED_PICKUP_SKIP"
          ? `${task.property.name}: failed pickup skip approved.`
          : `${task.property.name}: failed pickup request was rejected.${resolutionNotes ? ` ${resolutionNotes}` : ""}`,
        task.jobId
      );

      return NextResponse.json(updated);
    }

    const existingTask = await db.laundryTask.findUnique({
      where: { id: params.taskId },
      select: {
        id: true,
        jobId: true,
        property: { select: { name: true } },
        status: true,
        skipReasonCode: true,
        skipReasonNote: true,
        adminOverrideNote: true,
      },
    });
    if (!existingTask) {
      return NextResponse.json({ error: "Laundry task not found." }, { status: 404 });
    }

    if (body.status === LaundryStatus.SKIPPED_PICKUP && !body.skipReasonCode && !existingTask.skipReasonCode) {
      return NextResponse.json({ error: "Skip reason is required when marking pickup as skipped." }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (body.pickupDate !== undefined) data.pickupDate = new Date(body.pickupDate);
    if (body.dropoffDate !== undefined) data.dropoffDate = new Date(body.dropoffDate);
    if (body.status !== undefined) data.status = body.status;
    if (body.flagNotes !== undefined) data.flagNotes = body.flagNotes || null;
    if (body.status === LaundryStatus.SKIPPED_PICKUP) {
      data.noPickupRequired = true;
      data.skipReasonCode = body.skipReasonCode ?? existingTask.skipReasonCode ?? null;
      data.skipReasonNote = body.skipReasonNote ?? existingTask.skipReasonNote ?? null;
      data.adminOverrideNote = body.adminOverrideNote ?? body.flagNotes ?? existingTask.adminOverrideNote ?? null;
      data.adminOverrideById = session.user.id;
      data.adminOverrideAt = new Date();
    } else {
      if (body.skipReasonCode !== undefined) data.skipReasonCode = body.skipReasonCode || null;
      if (body.skipReasonNote !== undefined) data.skipReasonNote = body.skipReasonNote || null;
      if (body.adminOverrideNote !== undefined) {
        data.adminOverrideNote = body.adminOverrideNote || null;
        data.adminOverrideById = body.adminOverrideNote ? session.user.id : null;
        data.adminOverrideAt = body.adminOverrideNote ? new Date() : null;
      }
      if (body.status && existingTask.status === LaundryStatus.SKIPPED_PICKUP) {
        data.noPickupRequired = false;
      }
    }

    const task = await db.laundryTask.update({
      where: { id: params.taskId },
      data,
      include: {
        property: { select: { name: true, suburb: true } },
        job: { select: { scheduledDate: true } },
      },
    });

    if (body.status === LaundryStatus.SKIPPED_PICKUP) {
      await createRoleNotifications(
        [Role.LAUNDRY],
        "Pickup skipped",
        `${existingTask.property.name}: pickup skipped.${data.skipReasonCode ? ` Reason: ${String(data.skipReasonCode).replace(/_/g, " ")}` : ""}`,
        existingTask.jobId
      );
    }
    return NextResponse.json(task);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err.code === "P2025" ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await db.laundryConfirmation.deleteMany({ where: { laundryTaskId: params.taskId } });
    await db.laundryTask.delete({ where: { id: params.taskId } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err.code === "P2025" ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
