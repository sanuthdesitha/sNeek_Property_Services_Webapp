import { NextRequest, NextResponse } from "next/server";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

/**
 * PATCH /api/admin/qa/assignments/[id]
 *
 * Admin/ops edits to a single QA assignment: the planned inspection slot
 * (`scheduledFor`), the visit order (`sequence`), the deadline (`dueAt`), the
 * inspector, and notes. Ordering a whole day goes through
 * PATCH /api/admin/qa/assignments/reorder instead.
 */
const bodySchema = z.object({
  scheduledFor: z.string().datetime().nullable().optional(),
  sequence: z.number().int().min(1).max(999).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedToId: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const existing = await db.qaAssignment.findUnique({
      where: { id: params.id },
      select: { id: true, assignedToId: true, scheduledFor: true, sequence: true, dueAt: true },
    });
    if (!existing) return NextResponse.json({ error: "QA assignment not found." }, { status: 404 });

    if (body.assignedToId) {
      const user = await db.user.findUnique({
        where: { id: body.assignedToId },
        select: { role: true, isActive: true },
      });
      if (!user?.isActive || (user.role !== Role.QA_INSPECTOR && user.role !== Role.OPS_MANAGER)) {
        return NextResponse.json({ error: "Assign QA to an active QA inspector or OPS manager." }, { status: 400 });
      }
    }

    const data: Record<string, unknown> = {};
    if (body.scheduledFor !== undefined) data.scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
    if (body.sequence !== undefined) data.sequence = body.sequence;
    if (body.dueAt !== undefined) data.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.assignedToId !== undefined) {
      data.assignedToId = body.assignedToId;
      data.status = body.assignedToId ? QaAssignmentStatus.ASSIGNED : QaAssignmentStatus.OPEN;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const assignment = await db.qaAssignment.update({ where: { id: params.id }, data: data as any });

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: "QA_ASSIGNMENT_UPDATE",
          entity: "QaAssignment",
          entityId: assignment.id,
          before: existing as any,
          after: data as any,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ assignment });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
