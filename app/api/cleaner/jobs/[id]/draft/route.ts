import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  clearSharedCleanerJobDraft,
  getSharedCleanerJobDraft,
  saveSharedCleanerJobDraft,
} from "@/lib/cleaner/shared-job-draft";

const draftSchema = z.object({
  editorSessionId: z.string().trim().min(1).max(120),
  state: z.record(z.unknown()),
});

async function assertCleanerAssignment(jobId: string, userId: string) {
  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_userId: { jobId, userId } },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function isJobLocked(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!job) return true;
  const lockedStatuses: JobStatus[] = [
    JobStatus.SUBMITTED,
    JobStatus.QA_REVIEW,
    JobStatus.COMPLETED,
    JobStatus.INVOICED,
  ];
  return lockedStatuses.includes(job.status);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const isAssigned = await assertCleanerAssignment(params.id, session.user.id);
    if (!isAssigned) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }
    const draft = await getSharedCleanerJobDraft(params.id);
    return NextResponse.json({ draft });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const isAssigned = await assertCleanerAssignment(params.id, session.user.id);
    if (!isAssigned) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }
    if (await isJobLocked(params.id)) {
      return NextResponse.json({ error: "Job is already finished" }, { status: 409 });
    }
    const body = draftSchema.parse(await req.json());
    const updatedAt = new Date().toISOString();
    await saveSharedCleanerJobDraft(params.id, {
      updatedAt,
      updatedByUserId: session.user.id,
      updatedByName: session.user.name ?? session.user.email ?? "Cleaner",
      editorSessionId: body.editorSessionId,
      state: body.state,
    });
    return NextResponse.json({ ok: true, updatedAt });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const isAssigned = await assertCleanerAssignment(params.id, session.user.id);
    if (!isAssigned) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }
    await clearSharedCleanerJobDraft(params.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
