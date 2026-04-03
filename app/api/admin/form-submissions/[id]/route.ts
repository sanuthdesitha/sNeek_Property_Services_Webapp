import { NextRequest, NextResponse } from "next/server";
import { LaundryOutcome, MediaType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deleteObject } from "@/lib/s3";
import { generateJobReport } from "@/lib/reports/generator";

const mediaSchema = z.object({
  url: z.string().trim().min(1),
  s3Key: z.string().trim().min(1),
  fieldId: z.string().trim().min(1),
  mimeType: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
});

const patchSchema = z.object({
  data: z.record(z.any()).optional(),
  laundryReady: z.boolean().optional().nullable(),
  laundryOutcome: z.nativeEnum(LaundryOutcome).optional().nullable(),
  bagLocation: z.string().trim().optional().nullable(),
  addMediaUrls: z.array(mediaSchema).optional(),
  deleteMediaIds: z.array(z.string().trim().min(1)).optional(),
});

function detectMediaType(mimeType: string | null | undefined) {
  return String(mimeType ?? "").toLowerCase().startsWith("video/") ? MediaType.VIDEO : MediaType.PHOTO;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const existing = await db.formSubmission.findUnique({
      where: { id: params.id },
      include: { media: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    const nextData =
      body.data !== undefined
        ? {
            ...(existing.data && typeof existing.data === "object" && !Array.isArray(existing.data) ? (existing.data as Record<string, unknown>) : {}),
            ...body.data,
          }
        : undefined;

    const deleteMediaIds = Array.isArray(body.deleteMediaIds) ? body.deleteMediaIds : [];
    const mediaToDelete = existing.media.filter((media) => deleteMediaIds.includes(media.id));

    await db.$transaction(async (tx) => {
      await tx.formSubmission.update({
        where: { id: params.id },
        data: {
          data: nextData as any,
          laundryReady: body.laundryReady !== undefined ? body.laundryReady : undefined,
          laundryOutcome: body.laundryOutcome !== undefined ? body.laundryOutcome || null : undefined,
          bagLocation: body.bagLocation !== undefined ? body.bagLocation || null : undefined,
        },
      });

      if (deleteMediaIds.length > 0) {
        await tx.submissionMedia.deleteMany({
          where: {
            submissionId: params.id,
            id: { in: deleteMediaIds },
          },
        });
      }

      if ((body.addMediaUrls ?? []).length > 0) {
        await tx.submissionMedia.createMany({
          data: (body.addMediaUrls ?? []).map((media) => ({
            submissionId: params.id,
            fieldId: media.fieldId,
            mediaType: detectMediaType(media.mimeType),
            url: media.url,
            s3Key: media.s3Key,
            mimeType: media.mimeType || null,
            label: media.label || null,
          })),
        });
      }
    });

    for (const media of mediaToDelete) {
      if (!media.s3Key) continue;
      deleteObject(media.s3Key).catch(() => {});
    }

    generateJobReport(existing.jobId).catch(() => {});

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

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update submission." }, { status });
  }
}
