import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { db } from "@/lib/db";

const querySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  jobId: z.string().trim().optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      status: searchParams.get("status") ?? undefined,
      jobId: searchParams.get("jobId") ?? undefined,
    });
    const rows = await listContinuationRequests({
      status: query.status,
      jobId: query.jobId,
    });

    const jobIds = Array.from(new Set(rows.map((row) => row.jobId)));
    const userIds = Array.from(
      new Set(
        rows.flatMap((row) => [row.requestedByUserId, row.decidedByUserId]).filter(Boolean)
      )
    ) as string[];

    const [jobs, users] = await Promise.all([
      jobIds.length
        ? db.job.findMany({
            where: { id: { in: jobIds } },
            select: {
              id: true,
              jobType: true,
              status: true,
              scheduledDate: true,
              property: { select: { id: true, name: true, suburb: true } },
            },
          })
        : Promise.resolve([]),
      userIds.length
        ? db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
    ]);
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const userById = new Map(users.map((user) => [user.id, user]));

    return NextResponse.json(
      rows.map((row) => ({
        ...row,
        job: jobById.get(row.jobId) ?? null,
        requestedBy: userById.get(row.requestedByUserId) ?? null,
        decidedBy: row.decidedByUserId ? userById.get(row.decidedByUserId) ?? null : null,
      }))
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load continuation requests." }, { status });
  }
}

