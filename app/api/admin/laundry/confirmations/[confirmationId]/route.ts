import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { generateJobReport } from "@/lib/reports/generator";

const patchSchema = z.object({
  photoUrl: z.string().trim().optional(),
  s3Key: z.string().trim().min(1),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { confirmationId: string } },
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const existing = await db.laundryConfirmation.findUnique({
      where: { id: params.confirmationId },
      include: {
        laundryTask: {
          select: { jobId: true },
        },
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Laundry confirmation not found." },
        { status: 404 },
      );
    }

    const updated = await db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "LaundryConfirmation" WHERE "id" = ${params.confirmationId} FOR UPDATE`;
      const before = await transaction.laundryConfirmation.findUniqueOrThrow({
        where: { id: params.confirmationId },
      });
      const after = await transaction.laundryConfirmation.update({
        where: { id: params.confirmationId },
        data: {
          s3Key: body.s3Key,
          photoUrl: body.photoUrl?.trim() || publicUrl(body.s3Key),
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: session.user.id,
          action: "LAUNDRY_EVIDENCE_REPLACED",
          entity: "LaundryConfirmation",
          entityId: params.confirmationId,
          before: { s3Key: before.s3Key, photoUrl: before.photoUrl },
          after: { s3Key: after.s3Key, photoUrl: after.photoUrl },
        },
      });
      return after;
    });

    if (existing.laundryTask?.jobId) {
      generateJobReport(existing.laundryTask.jobId).catch(() => {});
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : 400;
    return NextResponse.json(
      { error: err.message ?? "Could not update laundry confirmation." },
      { status },
    );
  }
}
