import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  jobIds: z.array(z.string().trim().min(1)).min(1),
  status: z.nativeEnum(JobStatus),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const jobIds = Array.from(new Set(body.jobIds));

    const jobs = await db.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, status: true },
    });
    if (jobs.length !== jobIds.length) {
      return NextResponse.json({ error: "One or more jobs were not found." }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      for (const job of jobs) {
        await tx.job.update({
          where: { id: job.id },
          data: { status: body.status },
        });
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            jobId: job.id,
            action: "BULK_UPDATE_JOB_STATUS",
            entity: "Job",
            entityId: job.id,
            before: { status: job.status } as any,
            after: { status: body.status } as any,
          },
        });
      }
    });

    return NextResponse.json({ ok: true, updated: jobIds.length, status: body.status });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not bulk update job statuses." }, { status });
  }
}
