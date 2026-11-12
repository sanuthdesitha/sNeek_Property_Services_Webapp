import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SubmissionEditError, editFormSubmission } from "@/lib/forms/submission-edit";
import { loadSubmissionDetail } from "@/lib/forms/submission-detail";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function errorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : "";
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

/** GET — one submission with its questions, media, edit history and removed media (Forms → Submissions). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const detail = await loadSubmissionDetail(params.id);
    if (!detail) return NextResponse.json({ error: "Submission not found." }, { status: 404, headers });
    return NextResponse.json(detail, { headers });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load the submission." }, { status: errorStatus(err), headers });
  }
}

/**
 * PATCH — the office edits a submission: answers (history kept as before/after
 * in the audit log; internal fields refused), laundry fields, add media (upload
 * ownership checked), remove media (the stored original is kept as a tombstone)
 * and restore removed media. The report regenerates in the background. The
 * response keeps its old shape for the job pages.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await editFormSubmission({ id: session.user.id }, params.id, await req.json().catch(() => ({})));
    const updated = await db.formSubmission.findUnique({
      where: { id: params.id },
      include: {
        template: { select: { id: true, name: true, serviceType: true, schema: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
        media: { select: { id: true, fieldId: true, url: true, mediaType: true, createdAt: true, s3Key: true, mimeType: true, label: true } },
        job: {
          select: {
            id: true,
            status: true,
            scheduledDate: true,
            jobType: true,
            report: { select: { id: true, pdfUrl: true, updatedAt: true } },
            property: { select: { id: true, name: true, suburb: true } },
          },
        },
      },
    });
    return NextResponse.json(updated, { headers });
  } catch (err: unknown) {
    if (err instanceof SubmissionEditError) return NextResponse.json({ error: err.message }, { status: err.status, headers });
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Check the submission changes." }, { status: 400, headers });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not update submission." }, { status: errorStatus(err), headers });
  }
}
