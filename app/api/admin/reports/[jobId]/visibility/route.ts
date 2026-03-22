import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  clientVisible: z.boolean().optional(),
  cleanerVisible: z.boolean().optional(),
  laundryVisible: z.boolean().optional(),
  visibilityNote: z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const report = await db.report.update({
      where: { jobId: params.jobId },
      data: {
        clientVisible: body.clientVisible,
        cleanerVisible: body.cleanerVisible,
        laundryVisible: body.laundryVisible,
        visibilityNote: body.visibilityNote === null ? null : body.visibilityNote || undefined,
        visibilityUpdatedAt: new Date(),
        visibilityUpdatedById: session.user.id,
      },
      include: {
        visibilityUpdatedBy: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json(report);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err.code === "P2025" ? 404 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update report visibility." }, { status });
  }
}
