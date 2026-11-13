import "server-only";
import { db } from "@/lib/db";
import { hammingDistance } from "./photo-integrity";

/**
 * Flags for a person (QA and office only, never clients): facts that may
 * deserve a look, not verdicts. Missing facts stay "not checked" / "not
 * recorded"; they never count as a clean result.
 */

/** Within one job: this many differing bits (of 64) or fewer reads as "looks the same". */
export const SAME_JOB_NEAR_BITS = 2;
/** Across jobs at one property the same spot is photographed every clean, so only near-identical images are flagged. */
export const REUSE_NEAR_BITS = 2;
/** Grace around the job's clock times for the capture-time comparison. */
export const CLOCK_GRACE_MINUTES = 30;

export type IntegrityFlagKind = "duplicate_in_job" | "near_duplicate_in_job" | "reused_from_earlier_job" | "outside_clock_window";

export type IntegrityFlag = {
  kind: IntegrityFlagKind;
  mediaId: string;
  fieldLabel: string;
  detail: string;
  relatedMediaId: string | null;
  relatedJobId: string | null;
};

export type IntegrityPhotoState = {
  mediaId: string;
  fieldLabel: string;
  state: "checked" | "not_checked" | "could_not_check";
  error: string | null;
  capturedAt: string | null;
  capturedAtSource: string | null;
};

export type PhotoIntegrityReport = {
  hasSubmission: boolean;
  photos: IntegrityPhotoState[];
  flags: IntegrityFlag[];
  clockWindow: { start: string; end: string; open: boolean } | null;
  counts: { photos: number; checked: number; notChecked: number; couldNotCheck: number; captureTimeRecorded: number };
};

type MediaFacts = { id: string; fieldId: string; label: string | null; contentSha256: string | null; perceptualHash: string | null; capturedAt: Date | null; capturedAtSource: string | null; integrityCheckedAt: Date | null; integrityError: string | null };

export async function buildPhotoIntegrityReport(jobId: string, now = new Date()): Promise<PhotoIntegrityReport> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, propertyId: true } });
  const submission = job ? await db.formSubmission.findFirst({
    where: { jobId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { media: { where: { mediaType: "PHOTO" }, orderBy: { id: "asc" }, select: { id: true, fieldId: true, label: true, contentSha256: true, perceptualHash: true, capturedAt: true, capturedAtSource: true, integrityCheckedAt: true, integrityError: true } } },
  }) : null;
  if (!job || !submission) {
    return { hasSubmission: false, photos: [], flags: [], clockWindow: null, counts: { photos: 0, checked: 0, notChecked: 0, couldNotCheck: 0, captureTimeRecorded: 0 } };
  }
  const media: MediaFacts[] = submission.media;
  const label = (item: MediaFacts) => item.label ?? item.fieldId.replace(/_/g, " ");
  const photos: IntegrityPhotoState[] = media.map((item) => ({
    mediaId: item.id,
    fieldLabel: label(item),
    state: !item.integrityCheckedAt ? "not_checked" : item.integrityError ? "could_not_check" : "checked",
    error: item.integrityError,
    capturedAt: item.capturedAt?.toISOString() ?? null,
    capturedAtSource: item.capturedAtSource,
  }));
  const hashed = media.filter((item) => item.contentSha256 && item.perceptualHash && !item.integrityError);
  const flags: IntegrityFlag[] = [];

  // Duplicates inside this job: the same file, or a near-identical picture, used more than once.
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      const a = hashed[i]; const b = hashed[j];
      if (a.contentSha256 === b.contentSha256) {
        flags.push({ kind: "duplicate_in_job", mediaId: b.id, fieldLabel: label(b), detail: `The same file is also used for "${label(a)}".`, relatedMediaId: a.id, relatedJobId: null });
      } else if (hammingDistance(a.perceptualHash!, b.perceptualHash!) <= SAME_JOB_NEAR_BITS) {
        flags.push({ kind: "near_duplicate_in_job", mediaId: b.id, fieldLabel: label(b), detail: `Looks the same as the photo for "${label(a)}" (a different file).`, relatedMediaId: a.id, relatedJobId: null });
      }
    }
  }

  // Reuse from earlier cleans at the same property.
  if (hashed.length) {
    const earlier = await db.submissionMedia.findMany({
      where: { mediaType: "PHOTO", perceptualHash: { not: null }, integrityError: null, submission: { job: { propertyId: job.propertyId, id: { not: jobId } } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3000,
      select: { id: true, contentSha256: true, perceptualHash: true, submission: { select: { jobId: true, job: { select: { scheduledDate: true } } } } },
    });
    for (const item of hashed) {
      const match = earlier.find((other) => other.contentSha256 === item.contentSha256)
        ?? earlier.find((other) => hammingDistance(other.perceptualHash!, item.perceptualHash!) <= REUSE_NEAR_BITS);
      if (!match) continue;
      const exact = match.contentSha256 === item.contentSha256;
      const when = match.submission.job.scheduledDate.toISOString().slice(0, 10);
      flags.push({ kind: "reused_from_earlier_job", mediaId: item.id, fieldLabel: label(item), detail: `${exact ? "The same file was" : "A near-identical photo was"} submitted for the clean on ${when}. Check whether this photo was taken today.`, relatedMediaId: match.id, relatedJobId: match.submission.jobId });
    }
  }

  // Camera time against the job's clock times (only when the camera time was recorded).
  const logs = await db.timeLog.findMany({ where: { jobId }, select: { startedAt: true, stoppedAt: true } });
  let clockWindow: PhotoIntegrityReport["clockWindow"] = null;
  if (logs.length) {
    const start = new Date(Math.min(...logs.map((log) => log.startedAt.getTime())));
    const open = logs.some((log) => !log.stoppedAt);
    const end = open ? now : new Date(Math.max(...logs.map((log) => log.stoppedAt!.getTime())));
    clockWindow = { start: start.toISOString(), end: end.toISOString(), open };
    const grace = CLOCK_GRACE_MINUTES * 60_000;
    for (const item of media) {
      if (!item.capturedAt || item.integrityError) continue;
      const at = item.capturedAt.getTime();
      if (at < start.getTime() - grace || at > end.getTime() + grace) {
        flags.push({ kind: "outside_clock_window", mediaId: item.id, fieldLabel: label(item), detail: `The camera time is outside the job's clock times (by more than ${CLOCK_GRACE_MINUTES} minutes)${item.capturedAtSource === "exif-local" ? "; the camera recorded no time zone, so it was read in the business time zone" : ""}.`, relatedMediaId: null, relatedJobId: null });
      }
    }
  }

  return {
    hasSubmission: true,
    photos,
    flags,
    clockWindow,
    counts: {
      photos: photos.length,
      checked: photos.filter((photo) => photo.state === "checked").length,
      notChecked: photos.filter((photo) => photo.state === "not_checked").length,
      couldNotCheck: photos.filter((photo) => photo.state === "could_not_check").length,
      captureTimeRecorded: photos.filter((photo) => photo.capturedAt).length,
    },
  };
}
