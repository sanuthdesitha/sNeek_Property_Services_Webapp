import { NextResponse } from "next/server";
import { JobStatus, LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/security/encryption";
import { getNegativeQaWarning } from "@/lib/qa/feedback-history";
import { listConfirmedReworkForCleanerJob } from "@/lib/qa/rework-transfers";
import { publicUrl } from "@/lib/s3";
import { parseLaundryConfirmationMeta } from "@/lib/laundry/media";

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
        scheduledDate: true,
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

    // Surface prior sub-pass QA feedback (<80%) for this cleaner at this
    // property — best-effort; never block the briefing if it fails.
    let priorQaWarning: Awaited<ReturnType<typeof getNegativeQaWarning>> | null = null;
    try {
      priorQaWarning = await getNegativeQaWarning(session.user.id, job.propertyId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[briefing] prior QA warning lookup failed", err);
    }

    // Confirmed QA rework notes for this cleaner on this job — so they can see
    // exactly what QA flagged/redid and self-correct.
    let qaReworkNotes: Awaited<ReturnType<typeof listConfirmedReworkForCleanerJob>> = [];
    try {
      qaReworkNotes = await listConfirmedReworkForCleanerJob(params.id, session.user.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[briefing] QA rework lookup failed", err);
    }

    // Previous laundry DROP for THIS PROPERTY — so the cleaner knows where the
    // linen bags were left. We deliberately look at a PRIOR LaundryTask (drop
    // before this job's scheduled date) and never the task linked to THIS job
    // (jobId !== job.id): this job's own drop is a future event that hasn't
    // happened yet, so showing it would be meaningless.
    let previousLaundryDrop: {
      droppedAt: string | null;
      status: string;
      notes: string | null;
      photo: { id: string; url: string; label: string } | null;
    } | null = null;
    try {
      const scheduledDate = job.scheduledDate ?? new Date();
      const priorLaundry = await db.laundryTask.findFirst({
        where: {
          propertyId: job.propertyId,
          jobId: { not: job.id },
          status: { in: [LaundryStatus.DROPPED, LaundryStatus.PICKED_UP, LaundryStatus.CONFIRMED] },
          // The drop must have already happened, before this job is scheduled.
          droppedAt: { not: null, lt: scheduledDate },
        },
        orderBy: [{ droppedAt: "desc" }],
        select: {
          status: true,
          droppedAt: true,
          flagNotes: true,
          confirmations: {
            orderBy: [{ createdAt: "desc" }],
            select: {
              id: true,
              photoUrl: true,
              s3Key: true,
              notes: true,
              bagLocation: true,
            },
          },
        },
      });

      if (priorLaundry) {
        // Prefer the confirmation explicitly tagged as the DROPPED event; fall
        // back to the most recent confirmation that carries a photo.
        const dropped = priorLaundry.confirmations.find((c) => {
          const meta = parseLaundryConfirmationMeta(c.notes);
          return String((meta as Record<string, unknown>).event ?? "").toUpperCase() === "DROPPED";
        });
        const withPhoto =
          (dropped && (dropped.photoUrl || dropped.s3Key) ? dropped : null) ??
          priorLaundry.confirmations.find((c) => c.photoUrl || c.s3Key) ??
          null;

        const photoUrl = withPhoto
          ? withPhoto.photoUrl || (withPhoto.s3Key ? publicUrl(withPhoto.s3Key) : null)
          : null;

        // Surface the most useful note: the dropper's bag-location/notes from
        // the confirmation, else the task's flag notes.
        const confirmationMeta = withPhoto ? parseLaundryConfirmationMeta(withPhoto.notes) : {};
        const metaNote =
          typeof (confirmationMeta as Record<string, unknown>).note === "string"
            ? ((confirmationMeta as Record<string, unknown>).note as string)
            : null;
        const note =
          withPhoto?.bagLocation?.trim() ||
          metaNote?.trim() ||
          (withPhoto?.notes && !withPhoto.notes.trim().startsWith("{") ? withPhoto.notes.trim() : "") ||
          priorLaundry.flagNotes?.trim() ||
          null;

        previousLaundryDrop = {
          droppedAt: priorLaundry.droppedAt ? priorLaundry.droppedAt.toISOString() : null,
          status: priorLaundry.status,
          notes: note,
          photo: photoUrl
            ? { id: withPhoto?.id ?? "laundry-drop", url: photoUrl, label: "Linen drop-off" }
            : null,
        };
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[briefing] previous laundry drop lookup failed", err);
    }

    return NextResponse.json({
      lastPhotos,
      qaReworkNotes,
      previousLaundryDrop,
      accessCode: decryptSecret(job.property.accessCode) ?? pickLegacyAccessCode(job.property.accessInfo),
      alarmCode: decryptSecret(job.property.alarmCode),
      keyLocation: job.property.keyLocation?.trim() || null,
      accessNotes: job.property.accessNotes?.trim() || pickLegacyAccessNote(job.property.accessInfo),
      jobNotes: job.notes?.trim() || null,
      previousFlags,
      priorQaWarning,
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
