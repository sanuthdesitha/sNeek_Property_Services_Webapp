import { NextRequest, NextResponse } from "next/server";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { assertNotSelfInspection } from "@/lib/qa/self-review";

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
  // ── Pay overrides (admin adjusts everything) ───────────────────────────
  // Null on any of these means "clear the override and inherit again"
  // (settings default → inspector rate). "DEFAULT" is the UI's inherit option.
  payMode: z.enum(["FIXED", "HOURLY", "NONE", "DEFAULT"]).nullable().optional(),
  payAmount: z.number().min(0).max(10000).nullable().optional(),
  payHourlyRate: z.number().min(0).max(1000).nullable().optional(),
  payHoursAllocated: z.number().min(0).max(24).nullable().optional(),
  payNote: z.string().trim().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const existing = await db.qaAssignment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        // Needed by the self-review guard below: without the job there is no
        // way to know whose clean this inspection is of.
        jobId: true,
        assignedToId: true,
        scheduledFor: true,
        sequence: true,
        dueAt: true,
        status: true,
        completedAt: true,
        payMode: true,
        payAmount: true,
        payHourlyRate: true,
        payHoursAllocated: true,
        payNote: true,
        paySettledAmount: true,
        includedInPayrollRunId: true,
        includedInCleanerInvoiceId: true,
      },
    });
    if (!existing) return NextResponse.json({ error: "QA assignment not found." }, { status: 404 });

    const isPayEdit =
      body.payMode !== undefined ||
      body.payAmount !== undefined ||
      body.payHourlyRate !== undefined ||
      body.payHoursAllocated !== undefined ||
      body.payNote !== undefined;

    // SETTLED MONEY IS IMMUTABLE — the same rule the pay-adjustment PATCH
    // enforces. Once a payroll run has paid this inspection or a cleaner invoice
    // has billed it, re-pricing it would desynchronise the books from what was
    // actually paid out. The stamp is what stops a second payment, so it can no
    // longer be re-decided; correct it with a pay adjustment instead.
    const settledBy = existing.includedInPayrollRunId ?? existing.includedInCleanerInvoiceId ?? null;
    if (isPayEdit && settledBy) {
      return NextResponse.json(
        {
          error:
            "This inspection's pay has already been settled (paid by a payroll run or billed on a cleaner invoice) and can no longer be re-priced. Raise a correcting pay adjustment instead.",
          settledBy,
        },
        { status: 409 }
      );
    }

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
      // NOBODY INSPECTS THEIR OWN CLEAN — checked on REASSIGNMENT too. Guarding
      // only the original assignment would leave the rule one edit away from
      // being bypassed, and reassigning is exactly how an inspection changes
      // hands after the roster moves.
      if (body.assignedToId) {
        try {
          await assertNotSelfInspection(db, {
            jobId: existing.jobId,
            candidateUserId: body.assignedToId,
          });
        } catch (guardErr: any) {
          return NextResponse.json({ error: guardErr.message }, { status: 409 });
        }
      }
      data.assignedToId = body.assignedToId;
      data.status = body.assignedToId ? QaAssignmentStatus.ASSIGNED : QaAssignmentStatus.OPEN;
    }
    // Pay overrides. "DEFAULT" is stored as NULL — one representation of
    // "inherit", so nothing downstream has to know about two spellings.
    if (body.payMode !== undefined) data.payMode = body.payMode === "DEFAULT" ? null : body.payMode;
    if (body.payAmount !== undefined) data.payAmount = body.payAmount;
    if (body.payHourlyRate !== undefined) data.payHourlyRate = body.payHourlyRate;
    if (body.payHoursAllocated !== undefined) data.payHoursAllocated = body.payHoursAllocated;
    if (body.payNote !== undefined) data.payNote = body.payNote || null;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const assignment = await db.qaAssignment.update({ where: { id: params.id }, data: data as any });

    // Editing pay AFTER the inspection is complete is a money change the
    // inspector has already seen on their pay screen, so it gets its own audit
    // action — "someone re-priced finished work" must be searchable, not buried
    // inside the generic assignment-update stream.
    const auditAction = isPayEdit
      ? existing.status === "COMPLETED" || existing.completedAt
        ? "QA_ASSIGNMENT_PAY_EDIT_AFTER_COMPLETION"
        : "QA_ASSIGNMENT_PAY_EDIT"
      : "QA_ASSIGNMENT_UPDATE";

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: auditAction,
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
