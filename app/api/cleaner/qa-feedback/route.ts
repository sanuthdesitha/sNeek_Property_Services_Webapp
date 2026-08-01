import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl, publicUrl } from "@/lib/s3";
import { pickAuthoritativeReviews } from "@/lib/qa/review-dedupe";
import { getAppSettings } from "@/lib/settings";
import {
  displayKeyFor,
  ensureFlattened,
  normalizeQaPhotoRefs,
  type QaPhotoRef,
} from "@/lib/qa/annotation-composite";

/**
 * Cleaner-facing QA feedback feed. Returns the signed-in cleaner's recent QA
 * outcomes: QA/ADMIN reviews on jobs where they hold a non-removed assignment,
 * each with that job's QaIssues raised against THIS cleaner (severity,
 * category, description + QA photos presigned to display URLs) and the
 * cleaner's acknowledgement state. Bounded to the last ~60 days, newest 20.
 */
const WINDOW_DAYS = 60;

async function signKey(key: string): Promise<string> {
  try {
    return await getPresignedDownloadUrl(key, 3600);
  } catch {
    return publicUrl(key);
  }
}

/**
 * Presign a QaIssue's stored qaPhotoKeys to display URLs.
 *
 * This used to map `.key` and silently throw away `.annotatedKey`, which is why
 * a cleaner saw the photo but none of the markup QA drew on it — the whole
 * point of annotating. Selecting `annotatedKey` alone would have been just as
 * wrong: it is a TRANSPARENT overlay holding only the marks, so on its own it
 * renders as strokes floating on a checkerboard.
 *
 * The submit path now flattens the two into `flatKey` (lib/qa/annotation-
 * composite.ts), so the cleaner gets one opaque annotated image. Older issues
 * have no flatKey; for those we return the original plus the overlay so the
 * client can stack them, which is correct in a browser even though it is not
 * safe in a PDF.
 */
async function presignIssuePhotos(
  refs: QaPhotoRef[]
): Promise<{ url: string; overlayUrl: string | null; annotated: boolean }[]> {
  return Promise.all(
    refs.map(async (ref) => {
      const url = await signKey(displayKeyFor(ref));
      // Only needed as a fallback: when the composite exists it already
      // contains the marks and stacking would double-draw them.
      const overlayUrl =
        !ref.flatKey && ref.annotatedKey ? await signKey(ref.annotatedKey) : null;
      return { url, overlayUrl, annotated: Boolean(ref.flatKey || ref.annotatedKey) };
    })
  );
}

export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER]);
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

    // Over-fetch, then keep ONE review per job (QA outranks ADMIN, newest
    // wins): double-submits used to append duplicate reviews, and showing a
    // cleaner two verdicts for the same clean reads as two separate failures.
    const rawReviews = await db.qAReview.findMany({
      where: {
        kind: { in: ["QA", "ADMIN"] },
        createdAt: { gte: since },
        job: { assignments: { some: { userId: session.user.id, removedAt: null } } },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        jobId: true,
        score: true,
        passed: true,
        kind: true,
        createdAt: true,
        cleanerAcknowledgedAt: true,
        job: {
          select: {
            id: true,
            jobNumber: true,
            scheduledDate: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
    });

    const reviews = pickAuthoritativeReviews(rawReviews).slice(0, 20);

    const jobIds = Array.from(new Set(reviews.map((r) => r.jobId)));
    const issues = jobIds.length
      ? await db.qaIssue.findMany({
          where: { jobId: { in: jobIds }, cleanerId: session.user.id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            jobId: true,
            severity: true,
            category: true,
            description: true,
            createdAt: true,
            qaPhotoKeys: true,
          },
        })
      : [];

    // Issues raised before annotations were flattened at submit time carry only
    // the transparent overlay, which is unusable on its own. Composite them once
    // here and persist the result, so the owner's EXISTING failed inspections
    // start showing their markup too rather than only new ones. Self-healing and
    // idempotent: a row that already has flatKey is never touched again.
    const settings = await getAppSettings().catch(() => null);
    const categoryLabels = new Map(
      (settings?.accountability?.issueCategories ?? []).map((c) => [c.key, c.label])
    );

    const backfilled = await Promise.all(
      issues.map(async (i) => {
        const refs = normalizeQaPhotoRefs(i.qaPhotoKeys);
        const needsFlatten = refs.some((r) => !r.flatKey && r.annotatedKey);
        if (!needsFlatten) return { issue: i, refs };
        const flattened = await ensureFlattened(refs, session.user.id);
        if (flattened.some((r, idx) => r.flatKey !== refs[idx]?.flatKey)) {
          await db.qaIssue
            .update({ where: { id: i.id }, data: { qaPhotoKeys: flattened as any } })
            .catch(() => undefined); // display must not depend on the write
        }
        return { issue: i, refs: flattened };
      })
    );

    const issueRows = await Promise.all(
      backfilled.map(async ({ issue: i, refs }) => ({
        id: i.id,
        jobId: i.jobId,
        severity: String(i.severity),
        category: i.category,
        // The admin-configured label, not a prettified raw key — a cleaner
        // should read "Reset to reference images", not "Reset_to_reference".
        categoryLabel: categoryLabels.get(i.category) ?? null,
        description: i.description,
        createdAt: i.createdAt,
        photoUrls: await presignIssuePhotos(refs),
      }))
    );
    const issuesByJob = new Map<string, typeof issueRows>();
    for (const row of issueRows) {
      const list = issuesByJob.get(row.jobId) ?? [];
      list.push(row);
      issuesByJob.set(row.jobId, list);
    }

    const rows = reviews.map((r) => ({
      id: r.id,
      score: r.score,
      passed: r.passed,
      kind: r.kind,
      createdAt: r.createdAt,
      cleanerAcknowledgedAt: r.cleanerAcknowledgedAt,
      job: {
        id: r.job.id,
        jobNumber: r.job.jobNumber,
        scheduledDate: r.job.scheduledDate,
        propertyName: r.job.property?.name ?? "Property",
        propertySuburb: r.job.property?.suburb ?? null,
      },
      issues: (issuesByJob.get(r.jobId) ?? []).map(({ jobId: _jobId, ...issue }) => issue),
    }));

    return NextResponse.json({ reviews: rows });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed to load QA feedback." }, { status });
  }
}
