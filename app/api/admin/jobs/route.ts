import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createJobSchema } from "@/lib/validations/job";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import {
  NEW_JOB_RECEIPT_ACTION,
  NEW_JOB_RECEIPT_ENTITY,
  createAdminJobOnce,
  createAdminJobWithFollowUps,
  type CreateJobOptions,
} from "@/lib/jobs/admin-create";
import { isValidIdempotencyKey } from "@/lib/jobs/new-job/request-key";

/**
 * POST /api/admin/jobs — create one job. The create itself (timing rules,
 * job number, service site, follow-ups and the client's booking confirmation)
 * lives in `lib/jobs/admin-create.ts`, so the CSV import and the New job page
 * use the same service.
 *
 * New job page (2026-11), all optional and absent from older callers:
 * - `Idempotency-Key` header: the create runs once per key and person; a
 *   retry returns the job the first attempt made (`replayed: true`, 200).
 * - `skipPreferredCleaner`, `sendBookingConfirmation` in the body: the two
 *   per-job choices on the page (see `CreateJobOptions`).
 * The response is the created job as before, plus `followUps` saying what was
 * offered and sent, so the screen never claims more than happened.
 */
const choicesSchema = z.object({
  skipPreferredCleaner: z.boolean().optional(),
  sendBookingConfirmation: z.boolean().optional(),
});

function bodyHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const raw = await req.json();
    const body = createJobSchema.parse(raw);
    const choices = choicesSchema.parse(raw ?? {});
    const options: CreateJobOptions = {
      actor: { userId: session.user.id, name: session.user.name ?? null },
      ...choices,
    };
    const key = req.headers.get("idempotency-key");
    if (key === null) {
      const { job, followUps } = await createAdminJobWithFollowUps(body, options);
      return NextResponse.json({ ...job, followUps }, { status: 201 });
    }
    if (!isValidIdempotencyKey(key)) {
      return NextResponse.json({ error: "The request key is not valid. Start the job again." }, { status: 400 });
    }
    const result = await createAdminJobOnce(
      body,
      {
        key: `new-job:${session.user.id}:${key}`,
        userId: session.user.id,
        action: NEW_JOB_RECEIPT_ACTION,
        entity: NEW_JOB_RECEIPT_ENTITY,
        detail: { requestKey: key, bodyHash: bodyHash({ body, choices }) },
      },
      options,
    );
    const job = await db.job.findUnique({ where: { id: result.jobId }, include: { property: true } });
    return NextResponse.json(
      {
        ...job,
        replayed: result.replayed,
        followUps: result.followUps ?? null,
        changedSinceFirstAttempt: result.changedSinceFirstAttempt === true,
      },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not create job.") }, { status });
  }
}
