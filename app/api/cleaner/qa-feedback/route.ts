import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl, publicUrl } from "@/lib/s3";
import { pickAuthoritativeReviews } from "@/lib/qa/review-dedupe";

/**
 * Cleaner-facing QA feedback feed. Returns the signed-in cleaner's recent QA
 * outcomes: QA/ADMIN reviews on jobs where they hold a non-removed assignment,
 * each with that job's QaIssues raised against THIS cleaner (severity,
 * category, description + QA photos presigned to display URLs) and the
 * cleaner's acknowledgement state. Bounded to the last ~60 days, newest 20.
 */
const WINDOW_DAYS = 60;

/** Presign a QaIssue's stored qaPhotoKeys ([{key, annotatedKey?}] or plain
 *  strings) to display URLs. Best-effort — a failed presign falls back to the
 *  public URL. */
async function presignIssuePhotos(qaPhotoKeys: unknown): Promise<string[]> {
  const keys: string[] = Array.isArray(qaPhotoKeys)
    ? qaPhotoKeys
        .map((p) => (typeof p === "string" ? p : (p as { key?: string })?.key))
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];
  return Promise.all(
    keys.map(async (key) => {
      try {
        return await getPresignedDownloadUrl(key, 3600);
      } catch {
        return publicUrl(key);
      }
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

    const issueRows = await Promise.all(
      issues.map(async (i) => ({
        id: i.id,
        jobId: i.jobId,
        severity: String(i.severity),
        category: i.category,
        description: i.description,
        createdAt: i.createdAt,
        photoUrls: await presignIssuePhotos(i.qaPhotoKeys),
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
