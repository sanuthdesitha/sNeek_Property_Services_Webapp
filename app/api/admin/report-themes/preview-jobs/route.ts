import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** Recent jobs with a submitted form, for the Report themes preview picker. Read only. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobs = await db.job.findMany({
      where: { formSubmissions: { some: {} } },
      orderBy: { scheduledDate: "desc" },
      take: 12,
      select: { id: true, jobNumber: true, scheduledDate: true, property: { select: { name: true } } },
    });
    return NextResponse.json({ jobs: jobs.map((job) => ({ id: job.id, jobNumber: job.jobNumber, scheduledDate: job.scheduledDate, propertyName: job.property?.name ?? "" })) });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Recent jobs could not be read." : err.message }, { status });
  }
}
