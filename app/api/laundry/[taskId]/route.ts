import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { parseRouteStops } from "@/lib/laundry/route-plan";
import {
  LAUNDRY_DELETE_SKIP_REASON,
  evaluateLaundryDelete,
  stripTaskFromStops,
} from "@/lib/laundry/deletion";

/**
 * DELETE /api/laundry/[taskId] — remove a laundry task from the boards.
 *
 * Two modes (see lib/laundry/deletion.ts for the full reasoning):
 *   • SUPPRESS (default) — soft delete. The task becomes SKIPPED_PICKUP +
 *     noPickupRequired, which every v2 laundry board already filters out and
 *     which the planner refuses to override. Durable.
 *   • PERMANENT — the row and its LaundryConfirmation rows are really deleted.
 *     Because LaundryTask.jobId is @unique and the planner upserts on it, the
 *     planner WILL recreate the task on its next run unless the source
 *     turnover job is gone / the property has laundryEnabled off. The response
 *     says so (`mayBeRecreated`) and the UI warns.
 *
 * Role rules: ADMIN + OPS_MANAGER may delete; LAUNDRY may not (they keep the
 * existing failed-pickup "request skip/delete approval" path). A completed
 * (DROPPED) task is refused with 409 unless a full ADMIN passes `force`.
 */

const deleteSchema = z.object({
  mode: z.enum(["SUPPRESS", "PERMANENT"]).default("SUPPRESS"),
  force: z.boolean().optional(),
  reason: z.string().trim().max(2000).optional(),
});

async function notifyAdmins(subject: string, body: string, jobId: string | null, excludeUserId: string) {
  const recipients = await db.user.findMany({
    where: { role: Role.ADMIN, isActive: true, id: { not: excludeUserId } },
    select: { id: true },
  });
  if (!recipients.length) return;
  await db.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      jobId,
      channel: "PUSH",
      subject,
      body,
      status: "SENT",
      sentAt: new Date(),
    })),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    // LAUNDRY is allowed through requireRole so the refusal below can be a
    // helpful "use the approval request instead" rather than a bare 403.
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.LAUNDRY]);
    const { mode, force, reason } = deleteSchema.parse(await req.json().catch(() => ({})));

    const existing = await db.laundryTask.findUnique({
      where: { id: params.taskId },
      include: {
        property: { select: { id: true, name: true, suburb: true, laundryEnabled: true } },
        job: { select: { id: true, scheduledDate: true, status: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Laundry task not found." }, { status: 404 });
    }

    const decision = evaluateLaundryDelete({
      role: session.user.role,
      task: existing,
      force,
    });
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.message, code: decision.code },
        { status: decision.status },
      );
    }

    const auditBefore = {
      status: existing.status,
      propertyId: existing.propertyId,
      propertyName: existing.property?.name ?? null,
      suburb: existing.property?.suburb ?? null,
      jobId: existing.jobId,
      cleanDate: existing.job?.scheduledDate?.toISOString() ?? null,
      pickupDate: existing.pickupDate.toISOString(),
      dropoffDate: existing.dropoffDate.toISOString(),
      pickedUpAt: existing.pickedUpAt?.toISOString() ?? null,
      droppedAt: existing.droppedAt?.toISOString() ?? null,
    };
    const note = reason?.trim() || "Removed by an administrator.";

    // Cascade-safety + route hygiene, all in one transaction so a half-deleted
    // task can never be left behind a live route stop.
    const routes = await db.laundryRoute.findMany({
      where: { status: { in: ["ACTIVE", "DRAFT"] } },
      select: { id: true, stops: true },
    });

    let strippedRoutes = 0;
    await db.$transaction(async (tx) => {
      for (const route of routes) {
        const { stops, removed } = stripTaskFromStops(parseRouteStops(route.stops), params.taskId);
        if (!removed) continue;
        strippedRoutes += 1;
        await tx.laundryRoute.update({
          where: { id: route.id },
          data: { stops: stops as unknown as object },
        });
      }

      if (mode === "PERMANENT") {
        await tx.laundryConfirmation.deleteMany({ where: { laundryTaskId: params.taskId } });
        await tx.laundryTask.delete({ where: { id: params.taskId } });
      } else {
        await tx.laundryTask.update({
          where: { id: params.taskId },
          data: {
            status: LaundryStatus.SKIPPED_PICKUP,
            noPickupRequired: true,
            notifyLaundry: false,
            flagReason: null,
            skipReasonCode: LAUNDRY_DELETE_SKIP_REASON,
            skipReasonNote: note,
            adminOverrideNote: `Removed from the laundry boards: ${note}`,
            adminOverrideById: session.user.id,
            adminOverrideAt: new Date(),
          },
        });
        await tx.laundryConfirmation.create({
          data: {
            laundryTaskId: params.taskId,
            confirmedById: session.user.id,
            laundryReady: false,
            notes: JSON.stringify({
              event: "LAUNDRY_TASK_DELETED",
              mode,
              reason: note,
              previousStatus: existing.status,
            }),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: existing.jobId,
          action: "LAUNDRY_TASK_DELETED",
          entity: "LaundryTask",
          entityId: params.taskId,
          before: auditBefore as any,
          after: {
            mode,
            forced: Boolean(force),
            reason: note,
            routesStripped: strippedRoutes,
            actorRole: session.user.role,
          } as any,
        },
      });
    });

    // The planner recreates a permanently deleted task from its job unless the
    // job is gone or the property has laundry switched off.
    const mayBeRecreated =
      mode === "PERMANENT" && Boolean(existing.job) && existing.property?.laundryEnabled !== false;

    const propertyLabel = [existing.property?.name, existing.property?.suburb]
      .filter(Boolean)
      .join(", ") || "a property";

    await notifyAdmins(
      mode === "PERMANENT" ? "Laundry task deleted" : "Laundry task removed from the boards",
      `${propertyLabel}: ${session.user.email ?? "an operator"} ${
        mode === "PERMANENT" ? "permanently deleted" : "removed"
      } the laundry set (pickup ${existing.pickupDate.toLocaleDateString("en-AU")}). ${note}`,
      existing.jobId,
      session.user.id,
    ).catch(() => {
      /* notifications must never fail the delete itself */
    });

    return NextResponse.json({ ok: true, mode, mayBeRecreated, routesStripped: strippedRoutes });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not delete the laundry task." },
      { status: getApiErrorStatus(err) },
    );
  }
}
