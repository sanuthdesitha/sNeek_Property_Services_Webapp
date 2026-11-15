import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { pickAuthoritativeReview } from "@/lib/qa/authority";
import { hammingDistance } from "@/lib/media/photo-integrity";
import { activeConsents, type ActiveConsent } from "./consent";
import { SOCIAL_RATIOS, type SocialRatio } from "./networks";
import { SOCIAL_FIELD_IDS, socialPhotoField, type SocialPhotoField } from "./photo-fields";
import { liveScore, type LiveScore, NEAR_DUPLICATE_BITS, ratioFits, scoreWord, SOCIAL_SCORE_VERSION, type MeasuredComponents } from "./scoring-rules";
import type { CandidateJob, CandidateList, CandidatePhoto, CandidateSummary } from "./view-types";

/**
 * Which photos the social post generator may use (2026-11-17). ONE function
 * decides, for the candidates list, every export, draft creation, the agent
 * tools, agent draft approval and the moment of posting.
 *
 * Hard stops, each with a reason in words: the job is not finished
 * (COMPLETED or INVOICED); the authoritative QA review has not passed or
 * does not exist yet; an open case or damage report is linked to the job or
 * property; no live marketing permission of the property's client covers
 * the property; the form field is not on the allowlist; a before photo
 * without the before-photo permission; the photo is still being checked;
 * the file could not be read or scored. Then the score (stored measurements
 * plus fresh and recency), with near-duplicates and used photos marked.
 */

const FINISHED: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED];
const CLOSED_CASE_STATES = ["RESOLVED", "CLOSED", "CANCELLED"] as const;
const OPEN_DAMAGE = ["SUBMITTED", "UNDER_REVIEW"] as const;

type MediaRow = {
  id: string;
  fieldId: string;
  s3Key: string;
  mediaType: string;
  perceptualHash: string | null;
  integrityCheckedAt: Date | null;
  integrityError: string | null;
  submission: { jobId: string; submittedById: string };
};

type JobRow = {
  id: string;
  jobNumber: string;
  status: JobStatus;
  scheduledDate: Date;
  completedAt: Date | null;
  propertyId: string;
  property: { id: string; name: string; suburb: string; address: string; postcode: string | null; bedrooms: number; clientId: string; client: { name: string } | null };
};

export type EligiblePhoto = {
  photoId: string;
  s3Key: string;
  jobId: string;
  jobNumber: string;
  propertyId: string;
  propertyName: string;
  field: SocialPhotoField;
  consent: ActiveConsent;
  /** Only when the permission allows naming it. */
  suburb: string | null;
  bedrooms: number;
  finishedOn: string;
  /** For the caption linter: never shown or sent anywhere. */
  forbidden: { address: string; postcode: string | null; clientName: string | null; suburb: string | null; cleanerNames: string[] };
};

export type PhotoVerdict =
  | { photoId: string; ok: true; photo: EligiblePhoto; usedBefore: boolean; score: number | null; measured: StoredScore | null; hash: string | null; live: LiveScore | null }
  | { photoId: string; ok: false; reason: string; state: "left_out" | "checking" | "not_scored" | "hidden"; jobId: string | null };

type StoredScore = { points: number; components: MeasuredComponents; width: number; height: number; reasons: string[]; leftOut: string | null };

type JobVerdict = { ok: true; consent: ActiveConsent; qaScore: number | null } | { ok: false; reason: string; kind: "qa_not_reviewed" | "qa_failed" | "open_case" | "no_permission" | "not_finished" };

function dayOf(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

function finishedOn(job: JobRow, timeZone: string): string {
  return job.completedAt ? dayOf(job.completedAt, timeZone) : job.scheduledDate.toISOString().slice(0, 10);
}

const JOB_SELECT = {
  id: true, jobNumber: true, status: true, scheduledDate: true, completedAt: true, propertyId: true,
  property: { select: { id: true, name: true, suburb: true, address: true, postcode: true, bedrooms: true, clientId: true, client: { select: { name: true } } } },
} as const;

/** Job-level hard stops, read in a few queries for many jobs. */
async function judgeJobs(jobs: JobRow[]): Promise<Map<string, JobVerdict>> {
  const jobIds = jobs.map((job) => job.id);
  const propertyIds = Array.from(new Set(jobs.map((job) => job.propertyId)));
  const [reviews, cases, damage, consents] = await Promise.all([
    db.qAReview.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, kind: true, createdAt: true, passed: true, score: true } }),
    db.issueTicket.findMany({
      where: { state: { notIn: [...CLOSED_CASE_STATES] }, OR: [{ jobId: { in: jobIds } }, { propertyId: { in: propertyIds } }] },
      select: { jobId: true, propertyId: true, title: true },
    }),
    db.damageReport.findMany({ where: { status: { in: [...OPEN_DAMAGE] }, OR: [{ jobId: { in: jobIds } }, { propertyId: { in: propertyIds } }] }, select: { jobId: true, propertyId: true } }),
    activeConsents(propertyIds),
  ]);
  const verdicts = new Map<string, JobVerdict>();
  for (const job of jobs) {
    if (!FINISHED.includes(job.status)) {
      verdicts.set(job.id, { ok: false, kind: "not_finished", reason: "The job is not finished." });
      continue;
    }
    const review = pickAuthoritativeReview(reviews.filter((row) => row.jobId === job.id));
    if (!review) {
      verdicts.set(job.id, { ok: false, kind: "qa_not_reviewed", reason: "QA not reviewed yet. Photos appear once QA passes." });
      continue;
    }
    if (!review.passed) {
      verdicts.set(job.id, { ok: false, kind: "qa_failed", reason: "QA did not pass." });
      continue;
    }
    const openCase = cases.find((row) => row.jobId === job.id || row.propertyId === job.propertyId);
    const openDamage = damage.find((row) => row.jobId === job.id || row.propertyId === job.propertyId);
    if (openCase || openDamage) {
      verdicts.set(job.id, { ok: false, kind: "open_case", reason: openDamage ? "Open damage report. Left out until it is closed." : "Open case or issue. Left out until it is closed." });
      continue;
    }
    const consent = consents.get(job.propertyId);
    if (!consent) {
      verdicts.set(job.id, { ok: false, kind: "no_permission", reason: "No marketing permission is recorded for this property." });
      continue;
    }
    verdicts.set(job.id, { ok: true, consent, qaScore: Math.round(review.score) });
  }
  return verdicts;
}

async function cleanerNamesByJob(jobIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db.jobAssignment.findMany({ where: { jobId: { in: jobIds } }, select: { jobId: true, user: { select: { name: true } } } });
  const names = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.user?.name) continue;
    names.set(row.jobId, [...(names.get(row.jobId) ?? []), row.user.name]);
  }
  return names;
}

function readStored(row: { version: number; score: number | null; components: unknown; reasons: unknown; width: number | null; height: number | null; error: string | null } | undefined): StoredScore | "missing" | { error: string } {
  if (!row || row.version !== SOCIAL_SCORE_VERSION) return "missing";
  if (row.score === null || row.error) return { error: row.error ?? "Could not be scored." };
  const components = row.components as (MeasuredComponents & { leftOut?: string | null }) | null;
  if (!components || row.width === null || row.height === null) return { error: "Could not be scored." };
  const reasons = Array.isArray(row.reasons) ? row.reasons.filter((item): item is string => typeof item === "string") : [];
  return { points: row.score, components, width: row.width, height: row.height, reasons, leftOut: components.leftOut ?? null };
}

/** Sources of posts that went out (posted or waiting in a network inbox). */
async function postedSources(): Promise<{ ids: Set<string>; hashes: string[] }> {
  const assets = await db.marketingAsset.findMany({
    where: { sourceSubmissionMediaId: { not: null }, socialPostAssets: { some: { socialPost: { status: { in: ["PUBLISHED", "SENT_TO_INBOX", "UNCONFIRMED"] } } } } },
    select: { sourceSubmissionMediaId: true, sourceSecondMediaId: true },
    take: 5000,
  });
  const ids = new Set<string>();
  for (const asset of assets) {
    if (asset.sourceSubmissionMediaId) ids.add(asset.sourceSubmissionMediaId);
    if (asset.sourceSecondMediaId) ids.add(asset.sourceSecondMediaId);
  }
  const hashes = ids.size
    ? (await db.submissionMedia.findMany({ where: { id: { in: Array.from(ids) } }, select: { perceptualHash: true } })).map((row) => row.perceptualHash).filter((hash): hash is string => Boolean(hash))
    : [];
  return { ids, hashes };
}

type Evaluation = { verdicts: PhotoVerdict[]; jobs: JobRow[]; jobVerdicts: Map<string, JobVerdict>; timeZone: string };

async function evaluate(jobs: JobRow[], media: MediaRow[], now: Date, ratio: SocialRatio): Promise<Evaluation> {
  const timeZone = (await getAppSettings()).timezone || "Australia/Sydney";
  const jobVerdicts = await judgeJobs(jobs);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const [scores, posted, cleaners] = await Promise.all([
    db.socialPhotoScore.findMany({ where: { submissionMediaId: { in: media.map((row) => row.id) } } }),
    postedSources(),
    cleanerNamesByJob(jobs.map((job) => job.id)),
  ]);
  const scoreById = new Map(scores.map((row) => [row.submissionMediaId, row]));
  const verdicts: PhotoVerdict[] = [];
  const todayKey = dayOf(now, timeZone);
  for (const row of media) {
    const job = jobById.get(row.submission.jobId);
    const field = socialPhotoField(row.fieldId);
    const jobVerdict = job ? jobVerdicts.get(job.id) : undefined;
    if (!job || !field || row.mediaType !== "PHOTO") {
      verdicts.push({ photoId: row.id, ok: false, state: "hidden", reason: "This photo is evidence, not marketing, and is never offered.", jobId: job?.id ?? null });
      continue;
    }
    if (!jobVerdict?.ok) {
      verdicts.push({ photoId: row.id, ok: false, state: "hidden", reason: jobVerdict?.reason ?? "The job could not be checked.", jobId: job.id });
      continue;
    }
    if (field.kind === "BEFORE" && !jobVerdict.consent.allowBefore) {
      verdicts.push({ photoId: row.id, ok: false, state: "left_out", reason: "The owner's permission does not cover before photos.", jobId: job.id });
      continue;
    }
    if (!row.integrityCheckedAt) {
      verdicts.push({ photoId: row.id, ok: false, state: "checking", reason: "Still being checked.", jobId: job.id });
      continue;
    }
    if (row.integrityError) {
      verdicts.push({ photoId: row.id, ok: false, state: "left_out", reason: `Could not be scored: ${row.integrityError}`, jobId: job.id });
      continue;
    }
    const stored = readStored(scoreById.get(row.id));
    const finished = finishedOn(job, timeZone);
    const photo: EligiblePhoto = {
      photoId: row.id,
      s3Key: row.s3Key,
      jobId: job.id,
      jobNumber: job.jobNumber,
      propertyId: job.propertyId,
      propertyName: job.property.name,
      field,
      consent: jobVerdict.consent,
      suburb: jobVerdict.consent.allowSuburb ? job.property.suburb : null,
      bedrooms: job.property.bedrooms,
      finishedOn: finished,
      forbidden: {
        address: job.property.address,
        postcode: job.property.postcode,
        clientName: job.property.client?.name ?? null,
        suburb: jobVerdict.consent.allowSuburb ? null : job.property.suburb,
        cleanerNames: cleaners.get(job.id) ?? [],
      },
    };
    const usedBefore = posted.ids.has(row.id);
    if (stored === "missing") {
      verdicts.push({ photoId: row.id, ok: true, photo, usedBefore, score: null, measured: null, hash: row.perceptualHash, live: null });
      continue;
    }
    if ("error" in stored) {
      verdicts.push({ photoId: row.id, ok: false, state: "left_out", reason: `Could not be scored: ${stored.error}`, jobId: job.id });
      continue;
    }
    const nearPosted = !usedBefore && row.perceptualHash ? posted.hashes.some((hash) => hammingDistance(hash, row.perceptualHash!) < NEAR_DUPLICATE_BITS) : false;
    const ageDays = Math.max(0, (Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${finished}T00:00:00Z`)) / 86_400_000);
    const live = liveScore({ measured: stored, ratio, usedBefore, nearDuplicate: nearPosted, ageDays });
    verdicts.push({ photoId: row.id, ok: true, photo, usedBefore, score: live.score, measured: stored, hash: row.perceptualHash, live });
  }
  return { verdicts, jobs, jobVerdicts, timeZone };
}

const MEDIA_SELECT = { id: true, fieldId: true, s3Key: true, mediaType: true, perceptualHash: true, integrityCheckedAt: true, integrityError: true, submission: { select: { jobId: true, submittedById: true } } } as const;

/** The candidates list (no AI). Jobs at properties without permission are only counted. */
export async function listCandidates(input: { days: number; ratio: SocialRatio; includeBefore: boolean; hideUsed: boolean; room?: string | null; now?: Date }): Promise<CandidateList> {
  const now = input.now ?? new Date();
  const days = Math.min(60, Math.max(1, Math.round(input.days)));
  const from = new Date(now.getTime() - days * 86_400_000);
  const jobs = (await db.job.findMany({
    where: { status: { in: FINISHED }, OR: [{ completedAt: { gte: from, lte: now } }, { completedAt: null, scheduledDate: { gte: from, lte: now } }] },
    orderBy: [{ completedAt: "desc" }, { scheduledDate: "desc" }],
    take: 400,
    select: JOB_SELECT,
  })) as JobRow[];
  const media = (await db.submissionMedia.findMany({
    where: { mediaType: "PHOTO", fieldId: { in: [...SOCIAL_FIELD_IDS] }, submission: { jobId: { in: jobs.map((job) => job.id) } } },
    select: MEDIA_SELECT,
    take: 5000,
  })) as MediaRow[];
  const evaluation = await evaluate(jobs, media, now, input.ratio);
  return buildList(evaluation, input, from, now);
}

function buildList(evaluation: Evaluation, input: { ratio: SocialRatio; includeBefore: boolean; hideUsed: boolean; room?: string | null }, from: Date, now: Date): CandidateList {
  return finishList(evaluation.verdicts, evaluation.jobs, evaluation.jobVerdicts, evaluation.timeZone, input, from, now, []);
}

function finishList(
  verdicts: PhotoVerdict[], jobs: JobRow[], jobVerdicts: Map<string, JobVerdict>, timeZone: string,
  input: { ratio: SocialRatio; includeBefore: boolean; hideUsed: boolean; room?: string | null }, from: Date, now: Date, photos: CandidatePhoto[],
): CandidateList {
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  for (const verdict of verdicts) {
    if (!verdict.ok) {
      if (verdict.state === "hidden" || !verdict.jobId) continue;
      const job = jobById.get(verdict.jobId);
      if (!job) continue;
      photos.push(placeholder(verdict, job, timeZone));
      continue;
    }
    photos.push(candidateFrom(verdict));
  }
  markNearDuplicates(photos, verdicts);
  const visible = photos.filter((photo) => {
    if (!input.includeBefore && photo.fieldKind === "BEFORE") return false;
    if (input.hideUsed && photo.usedBefore) return false;
    if (input.room && photo.room !== input.room) return false;
    return true;
  });
  visible.sort((a, b) => stateRank(a.state) - stateRank(b.state) || (b.score ?? -1) - (a.score ?? -1));
  const summary = summarise(jobs, jobVerdicts, photos);
  const jobsOut: CandidateJob[] = [];
  for (const job of jobs) {
    const verdict = jobVerdicts.get(job.id);
    if (!verdict || (!verdict.ok && verdict.kind === "no_permission")) continue;
    const mine = photos.filter((photo) => photo.jobId === job.id);
    const usable = mine.filter((photo) => photo.state === "usable" || photo.state === "needs_look").length;
    jobsOut.push({
      jobId: job.id,
      jobNumber: job.jobNumber,
      propertyId: job.propertyId,
      propertyName: job.property.name,
      suburb: verdict.ok && verdict.consent.allowSuburb ? job.property.suburb : null,
      bedrooms: job.property.bedrooms ?? null,
      finishedOn: finishedOn(job, timeZone),
      qaScore: verdict.ok ? verdict.qaScore : null,
      state: verdict.ok ? (usable > 0 ? "usable" : "left_out") : verdict.kind === "open_case" ? "left_out" : "not_usable",
      reason: verdict.ok ? (usable > 0 ? null : "No usable photos in this job.") : verdict.reason,
      permission: verdict.ok
        ? { givenByName: verdict.consent.givenByName, method: verdict.consent.method, givenAt: verdict.consent.givenAt.toISOString(), allowSuburb: verdict.consent.allowSuburb, allowBefore: verdict.consent.allowBefore }
        : null,
      counts: {
        usable,
        listing: mine.filter((photo) => photo.fieldKind === "LISTING" && photo.state === "usable").length,
        before: mine.filter((photo) => photo.fieldKind === "BEFORE" && photo.state === "needs_look").length,
        usedInPost: mine.filter((photo) => photo.usedBefore).length,
        leftOut: mine.filter((photo) => photo.state === "left_out").length,
        checking: mine.filter((photo) => photo.state === "checking" || photo.state === "not_scored").length,
      },
    });
  }
  jobsOut.sort((a, b) => stateRank(a.state === "usable" ? "usable" : "left_out") - stateRank(b.state === "usable" ? "usable" : "left_out") || b.counts.usable - a.counts.usable);
  return { from: dayOf(from, timeZone), to: dayOf(now, timeZone), ratio: input.ratio, summary, jobs: jobsOut, photos: visible };
}

function stateRank(state: CandidatePhoto["state"]): number {
  return { usable: 0, needs_look: 1, not_scored: 2, checking: 3, left_out: 4 }[state];
}

function placeholder(verdict: Extract<PhotoVerdict, { ok: false }>, job: JobRow, timeZone: string): CandidatePhoto {
  return {
    photoId: verdict.photoId,
    jobId: job.id,
    jobNumber: job.jobNumber,
    propertyName: job.property.name,
    room: "",
    fieldLabel: "",
    fieldKind: "FINAL",
    score: null,
    scoreWord: "Not scored",
    components: null,
    reasons: [],
    leftOutReason: verdict.reason,
    state: verdict.state === "hidden" ? "left_out" : verdict.state,
    usedBefore: false,
    fits: [],
    finishedOn: finishedOn(job, timeZone),
  };
}

function candidateFrom(verdict: Extract<PhotoVerdict, { ok: true }>): CandidatePhoto {
  const { photo, measured } = verdict;
  const state: CandidatePhoto["state"] = !measured ? "not_scored" : measured.leftOut ? "left_out" : photo.field.kind === "BEFORE" ? "needs_look" : "usable";
  const reasons = [`Form field "${photo.field.label}"`, ...(measured?.reasons ?? [])];
  if (verdict.usedBefore) reasons.push("Used in a post before");
  else if (measured) reasons.push("Not used in any post");
  const fits = measured ? SOCIAL_RATIOS.filter((item) => ratioFits(measured.width, measured.height, item)) : [];
  return {
    photoId: photo.photoId,
    jobId: photo.jobId,
    jobNumber: photo.jobNumber,
    propertyName: photo.propertyName,
    room: photo.field.room,
    fieldLabel: photo.field.label,
    fieldKind: photo.field.kind,
    score: verdict.score,
    scoreWord: scoreWord(verdict.score),
    components: measured && verdict.live ? { ...measured.components, size: verdict.live.size, fresh: verdict.live.fresh, recency: verdict.live.recency } : null,
    reasons,
    leftOutReason: measured?.leftOut ?? (measured ? null : "Not scored yet: the score is being worked out."),
    state,
    usedBefore: verdict.usedBefore,
    fits,
    finishedOn: photo.finishedOn,
  };
}

/** Near-duplicates within a job: the lower-scored copy is left out with the bits apart. */
function markNearDuplicates(photos: CandidatePhoto[], verdicts: PhotoVerdict[]): void {
  const hashes = new Map<string, string | null>();
  for (const verdict of verdicts) {
    if (verdict.ok) hashes.set(verdict.photoId, verdict.hash);
  }
  const byJob = new Map<string, CandidatePhoto[]>();
  for (const photo of photos) {
    if (photo.state !== "usable" && photo.state !== "needs_look") continue;
    byJob.set(photo.jobId, [...(byJob.get(photo.jobId) ?? []), photo]);
  }
  for (const [, list] of Array.from(byJob.entries())) {
    list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    for (let index = 1; index < list.length; index++) {
      const hash = hashes.get(list[index].photoId);
      if (!hash) continue;
      for (let earlier = 0; earlier < index; earlier++) {
        const other = hashes.get(list[earlier].photoId);
        if (!other || list[earlier].state === "left_out") continue;
        const distance = hammingDistance(hash, other);
        if (distance < NEAR_DUPLICATE_BITS) {
          list[index].state = "left_out";
          list[index].leftOutReason = `Near-duplicate of the ${list[earlier].room.toLowerCase()} photo scored ${list[earlier].score ?? "–"} (picture fingerprint ${distance} bits apart)`;
          break;
        }
      }
    }
  }
}

function summarise(jobs: JobRow[], jobVerdicts: Map<string, JobVerdict>, photos: CandidatePhoto[]): CandidateSummary {
  const verdicts = jobs.map((job) => jobVerdicts.get(job.id));
  const count = (kind: string) => verdicts.filter((verdict) => verdict && !verdict.ok && verdict.kind === kind).length;
  const passedClean = verdicts.filter((verdict) => verdict && (verdict.ok || verdict.kind === "no_permission")).length;
  return {
    jobsCompleted: jobs.length,
    qaPassedClean: passedClean,
    qaNotReviewed: count("qa_not_reviewed"),
    qaFailed: count("qa_failed"),
    openCase: count("open_case"),
    atPermission: verdicts.filter((verdict) => verdict?.ok).length,
    noPermission: count("no_permission"),
    photosScored: photos.filter((photo) => photo.score !== null).length,
    stillChecking: photos.filter((photo) => photo.state === "checking" || photo.state === "not_scored").length,
    usable: photos.filter((photo) => photo.state === "usable" || photo.state === "needs_look").length,
    leftOut: photos.filter((photo) => photo.state === "left_out").length,
  };
}

/**
 * The same decision for chosen photos (export, draft, agent tools, approval,
 * posting). A photo not scored yet is still usable here: a person or agent
 * picked it, and the hard stops are what protect people.
 */
export async function checkPhotos(photoIds: readonly string[], options: { now?: Date; ratio?: SocialRatio } = {}): Promise<{ eligible: Map<string, EligiblePhoto>; refused: Array<{ photoId: string; reason: string }> }> {
  const ids = Array.from(new Set(photoIds));
  const media = (await db.submissionMedia.findMany({ where: { id: { in: ids } }, select: MEDIA_SELECT })) as MediaRow[];
  const jobIds = Array.from(new Set(media.map((row) => row.submission.jobId)));
  const jobs = (await db.job.findMany({ where: { id: { in: jobIds } }, select: JOB_SELECT })) as JobRow[];
  const evaluation = await evaluate(jobs, media, options.now ?? new Date(), options.ratio ?? "4:5");
  const eligible = new Map<string, EligiblePhoto>();
  const refused: Array<{ photoId: string; reason: string }> = [];
  for (const id of ids) {
    const verdict = evaluation.verdicts.find((item) => item.photoId === id);
    if (!verdict) refused.push({ photoId: id, reason: "This photo no longer exists." });
    else if (!verdict.ok) refused.push({ photoId: id, reason: verdict.state === "checking" ? "This photo is still being checked." : verdict.reason });
    else if (verdict.measured?.leftOut) refused.push({ photoId: id, reason: verdict.measured.leftOut });
    else eligible.set(id, verdict.photo);
  }
  return { eligible, refused };
}
