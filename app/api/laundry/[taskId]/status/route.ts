import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role } from "@prisma/client";
import { publicUrl } from "@/lib/s3";
import { startOfDay } from "date-fns";
import { getAppSettings } from "@/lib/settings";
import { propertyIsVisibleToLaundry } from "@/lib/laundry/teams";

const schema = z.object({
  status: z.enum([
    "PICKED_UP",
    "DROPPED",
    "RETURNED",
    "REVERT_TO_CONFIRMED",
    "REVERT_TO_PICKED_UP",
    "FAILED_PICKUP_RESCHEDULE",
    "FAILED_PICKUP_REQUEST",
  ]),
  confirm: z.boolean().optional(),
  bagCount: z.number().int().min(1).max(50).optional(),
  loadWeightKg: z.number().min(0).max(500).optional(),
  pickupPhotoKey: z.string().trim().optional(),
  dropoffLocation: z.string().trim().optional(),
  dropoffPhotoKey: z.string().trim().optional(),
  totalPrice: z.number().min(0).max(100000).optional(),
  earlyDropoffReason: z.string().trim().optional(),
  rescheduledPickupDate: z.string().datetime().optional(),
  requestedAction: z.enum(["SKIP", "DELETE"]).optional(),
  failedPickupReason: z.string().trim().max(2000).optional(),
  notes: z.string().optional(),
});

const editCompletedSchema = z.object({
  confirm: z.literal(true),
  bagCount: z.number().int().min(1).max(50).optional(),
  loadWeightKg: z.number().min(0).max(500).optional(),
  pickupPhotoKey: z.string().trim().optional(),
  dropoffLocation: z.string().trim().min(1).max(180).optional(),
  dropoffPhotoKey: z.string().trim().optional(),
  totalPrice: z.number().min(0).max(100000).optional(),
  earlyDropoffReason: z.string().trim().max(1000).optional(),
  notes: z.string().trim().min(3).max(4000),
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

async function createRoleNotifications(
  roles: Role[],
  subject: string,
  body: string,
  jobId?: string | null,
  excludeUserId?: string | null
) {
  const recipients = await db.user.findMany({
    where: {
      role: { in: roles },
      isActive: true,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
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

export async function POST(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    const {
      status,
      confirm,
      notes,
      bagCount,
      loadWeightKg,
      pickupPhotoKey,
      dropoffLocation,
      dropoffPhotoKey,
      totalPrice,
      earlyDropoffReason,
      rescheduledPickupDate,
      requestedAction,
      failedPickupReason,
    } = schema.parse(await req.json());
    if (confirm !== true) {
      return NextResponse.json({ error: "Confirmation required." }, { status: 400 });
    }
    const nextStatus = status === "RETURNED" ? "DROPPED" : status;

    const existing = await db.laundryTask.findUnique({
      where: { id: params.taskId },
      include: {
        property: { select: { name: true, suburb: true, accessInfo: true } },
        job: { select: { id: true, scheduledDate: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Laundry task not found" }, { status: 404 });
    }
    if (session.user.role === Role.LAUNDRY && !propertyIsVisibleToLaundry(existing.property?.accessInfo, session.user.id)) {
      return NextResponse.json({ error: "You cannot access this property's laundry schedule." }, { status: 403 });
    }

    if (nextStatus === "PICKED_UP" && !["CONFIRMED", "PENDING"].includes(existing.status)) {
      return NextResponse.json(
        { error: `Cannot mark PICKED_UP from status ${existing.status}` },
        { status: 400 }
      );
    }
    if (nextStatus === "DROPPED" && existing.status !== "PICKED_UP") {
      return NextResponse.json({ error: "Task must be PICKED_UP before RETURNED." }, { status: 400 });
    }
    if (nextStatus === "FAILED_PICKUP_RESCHEDULE" && !["CONFIRMED", "PENDING"].includes(existing.status)) {
      return NextResponse.json(
        { error: `Cannot mark failed pickup from status ${existing.status}` },
        { status: 400 }
      );
    }
    if (nextStatus === "FAILED_PICKUP_REQUEST" && !["CONFIRMED", "PENDING"].includes(existing.status)) {
      return NextResponse.json(
        { error: `Cannot request failed pickup approval from status ${existing.status}` },
        { status: 400 }
      );
    }

    if (nextStatus === "REVERT_TO_CONFIRMED") {
      if (!["PICKED_UP", "DROPPED"].includes(existing.status)) {
        return NextResponse.json({ error: "Can only revert from PICKED_UP/DROPPED." }, { status: 400 });
      }
      const task = await db.laundryTask.update({
        where: { id: params.taskId },
        data: {
          status: "CONFIRMED",
          pickedUpAt: null,
          droppedAt: null,
          flagNotes: notes || undefined,
        },
      });
      await db.laundryConfirmation.create({
        data: {
          laundryTaskId: params.taskId,
          confirmedById: session.user.id,
          laundryReady: true,
          notes: JSON.stringify({ event: "REVERT_TO_CONFIRMED", notes: notes || "" }),
        },
      });
      return NextResponse.json(task);
    }

    if (nextStatus === "REVERT_TO_PICKED_UP") {
      if (existing.status !== "DROPPED") {
        return NextResponse.json({ error: "Can only revert to PICKED_UP from DROPPED." }, { status: 400 });
      }
      const task = await db.laundryTask.update({
        where: { id: params.taskId },
        data: {
          status: "PICKED_UP",
          droppedAt: null,
          flagNotes: notes || undefined,
        },
      });
      await db.laundryConfirmation.create({
        data: {
          laundryTaskId: params.taskId,
          confirmedById: session.user.id,
          laundryReady: true,
          notes: JSON.stringify({ event: "REVERT_TO_PICKED_UP", notes: notes || "" }),
        },
      });
      return NextResponse.json(task);
    }

    if (nextStatus === "FAILED_PICKUP_RESCHEDULE") {
      const reason = failedPickupReason?.trim();
      if (!reason) {
        return NextResponse.json({ error: "A failed pickup reason is required." }, { status: 400 });
      }
      if (!rescheduledPickupDate) {
        return NextResponse.json({ error: "A new pickup date is required." }, { status: 400 });
      }

      const nextPickupDate = new Date(rescheduledPickupDate);
      if (Number.isNaN(nextPickupDate.getTime())) {
        return NextResponse.json({ error: "Invalid rescheduled pickup date." }, { status: 400 });
      }
      if (startOfDay(nextPickupDate).getTime() <= startOfDay(existing.pickupDate).getTime()) {
        return NextResponse.json(
          { error: "Rescheduled pickup date must be later than the current pickup date." },
          { status: 400 }
        );
      }
      if (startOfDay(nextPickupDate).getTime() > startOfDay(existing.dropoffDate).getTime()) {
        return NextResponse.json(
          { error: "Rescheduled pickup date cannot be after the scheduled drop-off date." },
          { status: 400 }
        );
      }

      const task = await db.laundryTask.update({
        where: { id: params.taskId },
        data: {
          pickupDate: nextPickupDate,
          status: "CONFIRMED",
        },
      });

      await db.laundryConfirmation.create({
        data: {
          laundryTaskId: params.taskId,
          confirmedById: session.user.id,
          laundryReady: true,
          notes: JSON.stringify({
            event: "FAILED_PICKUP_RESCHEDULE",
            reason,
            previousPickupDate: existing.pickupDate.toISOString(),
            rescheduledPickupDate: nextPickupDate.toISOString(),
            notes: notes || undefined,
          }),
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: existing.jobId,
          action: "LAUNDRY_FAILED_PICKUP_RESCHEDULED",
          entity: "LaundryTask",
          entityId: params.taskId,
          before: {
            status: existing.status,
            pickupDate: existing.pickupDate.toISOString(),
          },
          after: {
            status: "CONFIRMED",
            pickupDate: nextPickupDate.toISOString(),
            reason,
          },
        },
      });

      await createRoleNotifications(
        [Role.ADMIN, Role.OPS_MANAGER],
        "Laundry pickup rescheduled",
        `${existing.property.name}: pickup moved to ${nextPickupDate.toLocaleDateString("en-AU")} after failed attempt.`,
        existing.jobId,
        session.user.id
      );

      return NextResponse.json(task);
    }

    if (nextStatus === "FAILED_PICKUP_REQUEST") {
      const reason = failedPickupReason?.trim();
      if (!reason) {
        return NextResponse.json({ error: "A failed pickup reason is required." }, { status: 400 });
      }
      if (!requestedAction) {
        return NextResponse.json({ error: "Choose whether to request skip or delete approval." }, { status: 400 });
      }

      const summary = `Failed pickup - ${requestedAction.toLowerCase()} approval requested: ${reason}`;
      const task = await db.laundryTask.update({
        where: { id: params.taskId },
        data: {
          status: "FLAGGED",
          flagNotes: summary,
        },
      });

      await db.laundryConfirmation.create({
        data: {
          laundryTaskId: params.taskId,
          confirmedById: session.user.id,
          laundryReady: true,
          notes: JSON.stringify({
            event: "FAILED_PICKUP_REQUEST",
            approvalStatus: "PENDING",
            requestedAction,
            reason,
            previousStatus: existing.status,
            notes: notes || undefined,
          }),
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: existing.jobId,
          action: "LAUNDRY_FAILED_PICKUP_APPROVAL_REQUESTED",
          entity: "LaundryTask",
          entityId: params.taskId,
          before: {
            status: existing.status,
            flagNotes: null,
          },
          after: {
            status: "FLAGGED",
            requestedAction,
            reason,
          },
        },
      });

      await createRoleNotifications(
        [Role.ADMIN, Role.OPS_MANAGER],
        "Laundry pickup approval requested",
        `${existing.property.name}: laundry requested ${requestedAction.toLowerCase()} approval after failed pickup.`,
        existing.jobId,
        session.user.id
      );

      return NextResponse.json(task);
    }

    const data: any = { status: nextStatus };
    let actualDroppedAt: Date | null = null;
    let isEarlyDropoff = false;
    if (nextStatus === "PICKED_UP") {
      if (!bagCount || bagCount < 1) {
        return NextResponse.json({ error: "Bag count is required for pickup." }, { status: 400 });
      }
      data.pickedUpAt = new Date();
    }
    if (nextStatus === "DROPPED") {
      if (!dropoffLocation?.trim()) {
        return NextResponse.json({ error: "Drop-off location is required." }, { status: 400 });
      }
      if (settings.laundryPortalVisibility.requireDropoffPhoto && !dropoffPhotoKey?.trim()) {
        return NextResponse.json({ error: "Drop-off photo is required." }, { status: 400 });
      }
      if (totalPrice !== undefined && (!Number.isFinite(totalPrice) || totalPrice < 0)) {
        return NextResponse.json({ error: "Invalid total price." }, { status: 400 });
      }
      actualDroppedAt = new Date();
      isEarlyDropoff =
        startOfDay(actualDroppedAt).getTime() < startOfDay(existing.dropoffDate).getTime();
      if (settings.laundryPortalVisibility.requireEarlyDropoffReason && isEarlyDropoff && !earlyDropoffReason?.trim()) {
        return NextResponse.json(
          { error: "Reason is required when returning linen earlier than the scheduled drop-off date." },
          { status: 400 }
        );
      }
      data.droppedAt = actualDroppedAt;
    }
    if (notes) data.flagNotes = notes;

    const task = await db.laundryTask.update({
      where: { id: params.taskId },
      data,
    });

    await db.laundryConfirmation.create({
      data: {
        laundryTaskId: params.taskId,
        confirmedById: session.user.id,
        laundryReady: true,
        bagLocation: nextStatus === "DROPPED" ? dropoffLocation?.trim() : undefined,
        s3Key:
          nextStatus === "DROPPED"
            ? dropoffPhotoKey?.trim() || null
            : nextStatus === "PICKED_UP"
              ? pickupPhotoKey?.trim() || null
              : null,
        photoUrl:
          nextStatus === "DROPPED"
            ? dropoffPhotoKey?.trim()
              ? publicUrl(dropoffPhotoKey.trim())
              : undefined
            : nextStatus === "PICKED_UP" && settings.laundryPortalVisibility.showPickupPhoto && pickupPhotoKey?.trim()
              ? publicUrl(pickupPhotoKey.trim())
              : undefined,
        notes: JSON.stringify({
          event: nextStatus,
          bagCount: nextStatus === "PICKED_UP" ? bagCount : undefined,
          pickupPhotoKey: nextStatus === "PICKED_UP" ? pickupPhotoKey?.trim() : undefined,
          dropoffLocation: nextStatus === "DROPPED" ? dropoffLocation?.trim() : undefined,
          totalPrice: nextStatus === "DROPPED" ? totalPrice : undefined,
          loadWeightKg: nextStatus === "DROPPED" ? loadWeightKg : undefined,
          dropoffPhotoKey: nextStatus === "DROPPED" ? dropoffPhotoKey?.trim() : undefined,
          intendedDropoffDate: nextStatus === "DROPPED" ? existing.dropoffDate.toISOString() : undefined,
          actualDroppedAt: nextStatus === "DROPPED" ? (actualDroppedAt ?? new Date()).toISOString() : undefined,
          earlyDropoffReason: nextStatus === "DROPPED" && isEarlyDropoff ? earlyDropoffReason?.trim() : undefined,
          notes: notes || undefined,
        }),
      },
    });

    return NextResponse.json(task);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const body = editCompletedSchema.parse(await req.json().catch(() => ({})));

    const task = await db.laundryTask.findUnique({
      where: { id: params.taskId },
      include: {
        confirmations: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!task) {
      return NextResponse.json({ error: "Laundry task not found." }, { status: 404 });
    }
    if (task.status !== "DROPPED") {
      return NextResponse.json({ error: "Only returned laundry tasks can be edited." }, { status: 409 });
    }

    const confirmations = [...task.confirmations];
    const droppedConfirmation = [...confirmations].reverse().find((row) => parseNotesJson(row.notes).event === "DROPPED");
    if (!droppedConfirmation) {
      return NextResponse.json({ error: "Completed drop-off event not found for this task." }, { status: 409 });
    }
    const pickupConfirmation = [...confirmations].reverse().find((row) => parseNotesJson(row.notes).event === "PICKED_UP");

    const pickupMeta = parseNotesJson(pickupConfirmation?.notes);
    const droppedMeta = parseNotesJson(droppedConfirmation.notes);

    const before = {
      bagCount: typeof pickupMeta.bagCount === "number" ? pickupMeta.bagCount : undefined,
      loadWeightKg: typeof droppedMeta.loadWeightKg === "number" ? droppedMeta.loadWeightKg : undefined,
      dropoffLocation: typeof droppedMeta.dropoffLocation === "string" ? droppedMeta.dropoffLocation : droppedConfirmation.bagLocation ?? undefined,
      totalPrice: typeof droppedMeta.totalPrice === "number" ? droppedMeta.totalPrice : undefined,
      earlyDropoffReason: typeof droppedMeta.earlyDropoffReason === "string" ? droppedMeta.earlyDropoffReason : undefined,
      pickupPhotoKey: typeof pickupMeta.pickupPhotoKey === "string" ? pickupMeta.pickupPhotoKey : undefined,
      dropoffPhotoKey: typeof droppedMeta.dropoffPhotoKey === "string" ? droppedMeta.dropoffPhotoKey : undefined,
      notes: task.flagNotes ?? (typeof droppedMeta.notes === "string" ? droppedMeta.notes : undefined),
    };

    const after = {
      bagCount: body.bagCount ?? before.bagCount,
      loadWeightKg: body.loadWeightKg ?? before.loadWeightKg,
      dropoffLocation: body.dropoffLocation?.trim() || before.dropoffLocation,
      totalPrice: body.totalPrice ?? before.totalPrice,
      earlyDropoffReason: body.earlyDropoffReason?.trim() || before.earlyDropoffReason,
      pickupPhotoKey: body.pickupPhotoKey?.trim() || before.pickupPhotoKey,
      dropoffPhotoKey: body.dropoffPhotoKey?.trim() || before.dropoffPhotoKey,
      notes: body.notes.trim(),
    };

    const changedFields: string[] = [];
    for (const key of Object.keys(after) as Array<keyof typeof after>) {
      if ((before[key] ?? null) !== (after[key] ?? null)) {
        changedFields.push(String(key));
      }
    }

    if (changedFields.length === 0) {
      return NextResponse.json(
        { error: "No changes detected. Update at least one field before saving." },
        { status: 400 }
      );
    }

    const nextPickupMeta = {
      ...pickupMeta,
      event: "PICKED_UP",
      bagCount: after.bagCount,
      pickupPhotoKey: after.pickupPhotoKey,
      editedAt: new Date().toISOString(),
      editedById: session.user.id,
    };

    const nextDroppedMeta = {
      ...droppedMeta,
      event: "DROPPED",
      dropoffLocation: after.dropoffLocation,
      totalPrice: after.totalPrice,
      loadWeightKg: after.loadWeightKg,
      earlyDropoffReason: after.earlyDropoffReason,
      dropoffPhotoKey: after.dropoffPhotoKey,
      notes: after.notes,
      editedAt: new Date().toISOString(),
      editedById: session.user.id,
    };

    await db.$transaction(async (tx) => {
      await tx.laundryTask.update({
        where: { id: params.taskId },
        data: { flagNotes: after.notes },
      });

      if (pickupConfirmation && (changedFields.includes("bagCount") || changedFields.includes("pickupPhotoKey"))) {
        await tx.laundryConfirmation.update({
          where: { id: pickupConfirmation.id },
          data: {
            s3Key: after.pickupPhotoKey || pickupConfirmation.s3Key || null,
            photoUrl: after.pickupPhotoKey ? publicUrl(after.pickupPhotoKey) : pickupConfirmation.photoUrl,
            notes: JSON.stringify(nextPickupMeta),
          },
        });
      }

      await tx.laundryConfirmation.update({
        where: { id: droppedConfirmation.id },
        data: {
          bagLocation: after.dropoffLocation || droppedConfirmation.bagLocation,
          s3Key: after.dropoffPhotoKey || droppedConfirmation.s3Key || null,
          photoUrl: after.dropoffPhotoKey ? publicUrl(after.dropoffPhotoKey) : droppedConfirmation.photoUrl,
          notes: JSON.stringify(nextDroppedMeta),
        },
      });

      await tx.laundryConfirmation.create({
        data: {
          laundryTaskId: params.taskId,
          confirmedById: session.user.id,
          laundryReady: true,
          notes: JSON.stringify({
            event: "EDIT_COMPLETED",
            reason: after.notes,
            changedFields,
            before,
            after,
          }),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: task.jobId,
          action: "EDIT_LAUNDRY_COMPLETION",
          entity: "LaundryTask",
          entityId: task.id,
          before: before as any,
          after: { ...after, changedFields } as any,
        },
      });
    });

    const updated = await db.laundryTask.findUnique({
      where: { id: params.taskId },
      include: {
        property: { select: { name: true, suburb: true, linenBufferSets: true } },
        job: { select: { scheduledDate: true, status: true } },
        confirmations: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update laundry record." }, { status });
  }
}
