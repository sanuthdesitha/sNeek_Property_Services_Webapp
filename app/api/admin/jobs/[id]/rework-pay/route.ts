import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { setReworkPayDecision } from "@/lib/qa/rework-jobs";

const bodySchema = z.object({
  payeeCleanerId: z.string().min(1),
  amount: z.number().min(0).max(1000000),
});

/**
 * Admin decides who redoes a rework job and how much they're paid. When the
 * payee differs from the original cleaner, that amount is deducted from the
 * original cleaner and paid to the new one; same cleaner → no pay.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const job = await db.job.findUnique({ where: { id: params.id }, select: { isRework: true } });
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (!job.isRework) return NextResponse.json({ error: "Not a rework job." }, { status: 400 });

    await setReworkPayDecision({
      reworkJobId: params.id,
      reviewerUserId: session.user.id,
      payeeCleanerId: body.payeeCleanerId,
      amount: body.amount,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
