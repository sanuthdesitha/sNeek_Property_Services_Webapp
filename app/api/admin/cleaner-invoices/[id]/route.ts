import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["SUBMITTED", "XERO_PUSHED", "PAID", "VOID"]),
});

/** Update a cleaner invoice submission's status (e.g. mark it paid). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const updated = await db.cleanerInvoiceSubmission.update({
      where: { id: params.id },
      data: { status: body.status },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CLEANER_INVOICE_STATUS_UPDATE",
        entity: "CleanerInvoiceSubmission",
        entityId: params.id,
        after: { status: body.status } as any,
      },
    });

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update invoice status." }, { status });
  }
}
