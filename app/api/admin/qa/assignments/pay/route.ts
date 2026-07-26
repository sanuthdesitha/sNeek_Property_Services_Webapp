import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

/**
 * POST /api/admin/qa/assignments/pay
 *
 * Bulk-apply a pay rule to many QA inspections at once — the "set the default
 * for this batch" verb that sits beside the per-assignment override in
 * PATCH /api/admin/qa/assignments/[id].
 *
 * Settled inspections (stamped by a payroll run or a cleaner invoice) are NEVER
 * touched: they are skipped and reported back, rather than failing the whole
 * batch. That is the same immutability the pay-adjustment PATCH enforces —
 * money that has been paid cannot be re-priced, only corrected with a new
 * adjustment.
 */
const bodySchema = z
  .object({
    assignmentIds: z.array(z.string().trim().min(1)).min(1).max(500),
    payMode: z.enum(["FIXED", "HOURLY", "NONE", "DEFAULT"]).nullable().optional(),
    payAmount: z.number().min(0).max(10000).nullable().optional(),
    payHourlyRate: z.number().min(0).max(1000).nullable().optional(),
    payHoursAllocated: z.number().min(0).max(24).nullable().optional(),
    payNote: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (row) =>
      row.payMode !== undefined ||
      row.payAmount !== undefined ||
      row.payHourlyRate !== undefined ||
      row.payHoursAllocated !== undefined ||
      row.payNote !== undefined,
    { message: "Provide at least one pay field to apply." }
  );

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const rows = await db.qaAssignment.findMany({
      where: { id: { in: body.assignmentIds } },
      select: {
        id: true,
        includedInPayrollRunId: true,
        includedInCleanerInvoiceId: true,
      },
    });

    const settled = rows.filter(
      (row) => row.includedInPayrollRunId || row.includedInCleanerInvoiceId
    );
    const settledIds = new Set(settled.map((row) => row.id));
    const editableIds = rows.filter((row) => !settledIds.has(row.id)).map((row) => row.id);

    const data: Record<string, unknown> = {};
    // "DEFAULT" stores as NULL — one representation of "inherit the setting".
    if (body.payMode !== undefined) data.payMode = body.payMode === "DEFAULT" ? null : body.payMode;
    if (body.payAmount !== undefined) data.payAmount = body.payAmount;
    if (body.payHourlyRate !== undefined) data.payHourlyRate = body.payHourlyRate;
    if (body.payHoursAllocated !== undefined) data.payHoursAllocated = body.payHoursAllocated;
    if (body.payNote !== undefined) data.payNote = body.payNote || null;

    let updated = 0;
    if (editableIds.length > 0) {
      const result = await db.qaAssignment.updateMany({
        where: {
          id: { in: editableIds },
          // Re-assert the guard inside the write so a run that settles between
          // the read above and this update can't be overwritten.
          includedInPayrollRunId: null,
          includedInCleanerInvoiceId: null,
        },
        data: data as any,
      });
      updated = result.count;
    }

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: "QA_ASSIGNMENT_PAY_BULK",
          entity: "QaAssignment",
          entityId: editableIds.join(",").slice(0, 900) || "none",
          after: {
            applied: data,
            updated,
            requested: body.assignmentIds.length,
            skippedSettledIds: settled.map((row) => row.id),
          } as any,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({
      updated,
      requested: body.assignmentIds.length,
      skippedSettled: settled.length,
      skippedSettledIds: settled.map((row) => row.id),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
