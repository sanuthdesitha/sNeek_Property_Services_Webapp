import { NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/security/encryption";

function pickLegacyAccessNote(accessInfo: unknown) {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  const row = accessInfo as Record<string, unknown>;
  const lockbox = typeof row.lockbox === "string" ? row.lockbox.trim() : "";
  const parking = typeof row.parking === "string" ? row.parking.trim() : "";
  const other = typeof row.other === "string" ? row.other.trim() : "";
  return [lockbox, parking, other].filter(Boolean).join("\n") || null;
}

function pickLegacyAccessCode(accessInfo: unknown) {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  const value = (accessInfo as Record<string, unknown>).codes;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const job = await db.job.findFirst({
      where: {
        id: params.id,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: {
        id: true,
        propertyId: true,
        notes: true,
        property: {
          select: {
            id: true,
            accessCode: true,
            alarmCode: true,
            keyLocation: true,
            accessNotes: true,
            accessInfo: true,
          },
        },
        laundryTask: {
          select: {
            status: true,
            pickupDate: true,
            dropoffDate: true,
          },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const previousJobs = await db.job.findMany({
      where: {
        propertyId: job.propertyId,
        id: { not: job.id },
        status: { in: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      orderBy: [{ scheduledDate: "desc" }],
      take: 3,
      select: {
        id: true,
        formSubmissions: {
          orderBy: [{ createdAt: "desc" }],
          take: 1,
          select: {
            media: {
              orderBy: [{ createdAt: "desc" }],
              select: {
                id: true,
                url: true,
                label: true,
                mediaType: true,
                fieldId: true,
                createdAt: true,
              },
            },
          },
        },
        qaReviews: {
          orderBy: [{ createdAt: "desc" }],
          take: 1,
          select: { flags: true },
        },
      },
    });

    const lastPhotos = previousJobs
      .flatMap((row) => row.formSubmissions[0]?.media ?? [])
      .filter((row) => String(row.mediaType ?? "PHOTO").toUpperCase() === "PHOTO")
      .slice(0, 12)
      .map((row) => ({
        id: row.id,
        url: row.url,
        label: row.label || row.fieldId,
        mediaType: row.mediaType,
      }));

    const latestFlagsRaw = previousJobs.find((row) => Array.isArray(row.qaReviews[0]?.flags))?.qaReviews[0]?.flags;
    const previousFlags = Array.isArray(latestFlagsRaw)
      ? latestFlagsRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    return NextResponse.json({
      lastPhotos,
      accessCode: decryptSecret(job.property.accessCode) ?? pickLegacyAccessCode(job.property.accessInfo),
      alarmCode: decryptSecret(job.property.alarmCode),
      keyLocation: job.property.keyLocation?.trim() || null,
      accessNotes: job.property.accessNotes?.trim() || pickLegacyAccessNote(job.property.accessInfo),
      jobNotes: job.notes?.trim() || null,
      previousFlags,
      laundryInstructions: job.laundryTask
        ? {
            status: job.laundryTask.status,
            pickupDate: job.laundryTask.pickupDate,
            dropoffDate: job.laundryTask.dropoffDate,
          }
        : null,
    });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load briefing." }, { status });
  }
}
