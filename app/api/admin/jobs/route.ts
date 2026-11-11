import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createJobSchema } from "@/lib/validations/job";
import { Role } from "@prisma/client";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { createAdminJob } from "@/lib/jobs/admin-create";

/**
 * POST /api/admin/jobs — create one job. The create itself (timing rules,
 * job number, service site, follow-ups and the client's booking confirmation)
 * lives in `lib/jobs/admin-create.ts`, unchanged, so the CSV import uses the
 * same service.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createJobSchema.parse(await req.json());
    const job = await createAdminJob(body);
    return NextResponse.json(job, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not create job.") }, { status });
  }
}
