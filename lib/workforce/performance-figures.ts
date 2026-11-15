/**
 * The cleaner performance figures, worked out from one cleaner's jobs and
 * offers in a window. Pure: lib/workforce/performance.ts loads the rows, this
 * file only counts them, so the rules can be tested on fixtures.
 *
 * Owner report 2026-11-15: the performance page showed "Photos and forms
 * 100%" for a cleaner who had skipped many forms, an average of "498 min
 * early" next to "On time 100%", disputes on 77% of jobs and attendance 47%
 * next to no-shows 3%. Each figure now states its own basis (repeated on the
 * page under "How this is worked out"):
 *
 *  - Finished jobs (the window's job count): jobs this cleaner is still
 *    assigned to (not removed, declined or transferred), scheduled on a
 *    Sydney day in the window, that reached submission (Submitted, QA review,
 *    Completed or Invoiced; the Quality hub's "cleans"), not skipped. A team
 *    job counts once for each cleaner on it.
 *  - Quality: the authoritative QA review of each finished job (QA > ADMIN >
 *    AUTO, then latest; the Quality hub and Insights rule), averaged over the
 *    finished jobs that have one.
 *  - On time / punctuality: this cleaner's own first clock-in on a finished
 *    job against its scheduled start (the job's Sydney day at its start time,
 *    Sydney time, daylight saving included; Insights' `scheduledStart`). On
 *    time = no later than 15 minutes after the start (ON_TIME_GRACE_MINUTES).
 *    A job without a start time or without this cleaner's clock-in is left
 *    out and counted, never treated as on time.
 *  - Photos and forms: finished jobs whose form was submitted with at least
 *    one photo, out of ALL finished jobs. A job without a form counts against
 *    it. A team job has one shared form, so it counts for each cleaner on it.
 *  - Disputes: finished jobs with a "Client dispute" case (IssueTicket
 *    caseType CLIENT_DISPUTE, not cancelled). Other cases (damage, operations,
 *    SLA, lost property), QA issues and pay adjustments are not disputes.
 *  - Client rating: one rating per finished job (the feedback form's overall
 *    rating, else the satisfaction score), averaged.
 *  - Attendance / no-shows: jobs this cleaner is still assigned to, scheduled
 *    on a Sydney day in the window before today, not cancelled or skipped.
 *    Attended = this cleaner clocked in or submitted the form. No-show = not
 *    attended and the job was never started (still unassigned, offered or
 *    assigned). Anything else (started or finished with no record of this
 *    cleaner) is "not recorded" and left out of both rates.
 *  - Replies within 1 hour: offers made to this cleaner in the window, at
 *    least an hour ago, answered (accepted, declined or passed on) within 60
 *    minutes. "Accepted on job start" is not a reply. Jobs the office put
 *    straight onto them (accepted at the moment they were assigned) were not
 *    offers and are left out.
 *
 * A rate or average needs MIN_BASIS_ROW records (Insights' per-person
 * minimum); below it the figure is null ("Not enough data") and the counts
 * are still returned so the page can say "2 of 30 jobs had a clock-in".
 */
import { MIN_BASIS_ROW } from "@/lib/insights/measure";
import { ON_TIME_GRACE_MINUTES, scheduledStart } from "@/lib/insights/job-facts";
import { pickAuthoritativeReview } from "@/lib/quality/authority";
import { SUBMITTED_JOB_STATUSES } from "@/lib/quality/where";
import { sydneyDateKey } from "@/lib/time/sydney-range";

export const PERFORMANCE_MIN_SAMPLE = MIN_BASIS_ROW;
export { ON_TIME_GRACE_MINUTES };

/** An answer within this many minutes of the offer is a reply "within 1 hour". */
export const REPLY_WITHIN_MINUTES = 60;

/** Set by the job start route when a cleaner starts a job they never answered. */
export const ACCEPTED_ON_JOB_START_NOTE = "Accepted on job start.";

/**
 * An assignment "answered" within this many seconds of being made was
 * accepted by the office as it assigned (rework jobs and their payees); it
 * was never an offer to reply to.
 */
export const OFFICE_ACCEPTED_SECONDS = 5;

const FINISHED_STATUSES = new Set<string>(SUBMITTED_JOB_STATUSES);
/** A job still in one of these after its day was never started by anyone. */
const NOT_STARTED_STATUSES = new Set<string>(["UNASSIGNED", "OFFERED", "ASSIGNED"]);

export type PerformanceReview = { score: number; kind: string; createdAt: Date };

/** One job this cleaner is assigned to (active assignment), as the loader read it. */
export type PerformanceJob = {
  jobId: string;
  status: string;
  scheduledDate: Date;
  startTime: string | null;
  cleanSkipStatus: string;
  /** This cleaner's clock-ins (TimeLog.startedAt) on the job. */
  clockIns: Date[];
  /** Form submissions for the job (one shared form per job). */
  submissions: Array<{ submittedById: string; photoCount: number }>;
  reviews: PerformanceReview[];
  /** Client dispute cases on the job that were not cancelled. */
  disputeCases: number;
  /** The job's client rating (1–5), or null when the client has not rated it. */
  rating: number | null;
};

/** One assignment made to this cleaner in the window (removed ones included). */
export type PerformanceOffer = {
  offeredAt: Date;
  respondedAt: Date | null;
  responseStatus: string;
  responseNote: string | null;
};

export type PerformanceFigureInput = {
  userId: string;
  /** Today's Sydney day (yyyy-MM-dd). */
  todayKey: string;
  jobs: readonly PerformanceJob[];
  offers: readonly PerformanceOffer[];
  now: Date;
};

export type QualityFigure = { score: number | null; sampleSize: number; jobs: number };
export type OnTimeFigure = {
  onTimePercent: number | null;
  /** Finished jobs with a start time and this cleaner's clock-in. */
  sampleSize: number;
  onTime: number;
  jobs: number;
  noClockIn: number;
  noStartTime: number;
};
export type PunctualityFigure = {
  /** Average minutes from scheduled start to first clock-in (negative = early). */
  avgMinutesLate: number | null;
  sampleSize: number;
  jobs: number;
  noClockIn: number;
  noStartTime: number;
};
export type AttendanceFigure = {
  /** Attended jobs (kept under its old name for existing screens). */
  completedJobs: number;
  /** Attended + no-shows: the jobs whose attendance is known. */
  assignedJobs: number;
  percent: number | null;
  dueJobs: number;
  notRecorded: number;
};
export type DocumentationFigure = {
  fullyDocumentedPercent: number | null;
  /** Finished jobs (every one needs a form with photos). */
  sampleSize: number;
  documented: number;
  withoutForm: number;
  formWithoutPhotos: number;
};
export type RatingFigure = { avgRating: number | null; sampleSize: number; jobs: number };
export type ReplyFigure = {
  acceptedPercent: number | null;
  /** Offers whose hour has passed. */
  sampleSize: number;
  repliedWithinHour: number;
  officeAccepted: number;
};
export type DisputeFigure = { disputes: number; totalJobs: number; percent: number | null };
export type NoShowFigure = { noShows: number; scheduled: number; percent: number | null; notRecorded: number };

export type JobPerformanceFigures = {
  finishedJobs: number;
  quality: QualityFigure;
  reliability: OnTimeFigure;
  punctuality: PunctualityFigure;
  attendance: AttendanceFigure;
  documentation: DocumentationFigure;
  customerSatisfaction: RatingFigure;
  responseRate: ReplyFigure;
  disputeRate: DisputeFigure;
  noShowRate: NoShowFigure;
};

function enough(count: number): boolean {
  return count >= PERFORMANCE_MIN_SAMPLE;
}

function percent(part: number, whole: number, decimals = 0): number | null {
  if (!enough(whole)) return null;
  const factor = 10 ** decimals;
  return Math.round((part / whole) * 100 * factor) / factor;
}

function average(values: readonly number[], decimals: number): number | null {
  if (!enough(values.length)) return null;
  const factor = 10 ** decimals;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * factor) / factor;
}

export function isFinishedJob(job: Pick<PerformanceJob, "status" | "cleanSkipStatus">): boolean {
  return FINISHED_STATUSES.has(job.status) && job.cleanSkipStatus !== "SKIPPED";
}

/** Minutes from the scheduled start to this cleaner's first clock-in, or why there is none. */
export function startDelay(job: PerformanceJob): { minutes: number } | { missing: "no_start_time" | "no_clock_in" } {
  const start = scheduledStart(sydneyDateKey(job.scheduledDate), job.startTime);
  if (!start) return { missing: "no_start_time" };
  if (job.clockIns.length === 0) return { missing: "no_clock_in" };
  const first = Math.min(...job.clockIns.map((clockIn) => clockIn.getTime()));
  return { minutes: (first - start.getTime()) / 60_000 };
}

function qualityFigure(finished: readonly PerformanceJob[]): QualityFigure {
  const scores = finished
    .map((job) => pickAuthoritativeReview(job.reviews)?.score)
    .filter((score): score is number => typeof score === "number");
  return { score: average(scores, 1), sampleSize: scores.length, jobs: finished.length };
}

function startFigures(finished: readonly PerformanceJob[]): { reliability: OnTimeFigure; punctuality: PunctualityFigure } {
  const delays: number[] = [];
  let noClockIn = 0;
  let noStartTime = 0;
  for (const job of finished) {
    const delay = startDelay(job);
    if ("minutes" in delay) delays.push(delay.minutes);
    else if (delay.missing === "no_clock_in") noClockIn += 1;
    else noStartTime += 1;
  }
  const onTime = delays.filter((minutes) => minutes <= ON_TIME_GRACE_MINUTES).length;
  const meanDelay = average(delays, 0);
  return {
    reliability: { onTimePercent: percent(onTime, delays.length), sampleSize: delays.length, onTime, jobs: finished.length, noClockIn, noStartTime },
    // Math.round can give -0 for a small early average; show it as on time.
    punctuality: { avgMinutesLate: meanDelay === null ? null : meanDelay + 0, sampleSize: delays.length, jobs: finished.length, noClockIn, noStartTime },
  };
}

function documentationFigure(finished: readonly PerformanceJob[]): DocumentationFigure {
  let documented = 0;
  let withoutForm = 0;
  let formWithoutPhotos = 0;
  for (const job of finished) {
    if (job.submissions.length === 0) withoutForm += 1;
    else if (job.submissions.some((submission) => submission.photoCount > 0)) documented += 1;
    else formWithoutPhotos += 1;
  }
  return { fullyDocumentedPercent: percent(documented, finished.length), sampleSize: finished.length, documented, withoutForm, formWithoutPhotos };
}

function ratingFigure(finished: readonly PerformanceJob[]): RatingFigure {
  const ratings = finished.map((job) => job.rating).filter((rating): rating is number => typeof rating === "number");
  const avg = enough(ratings.length) ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
  return { avgRating: avg, sampleSize: ratings.length, jobs: finished.length };
}

function disputeFigure(finished: readonly PerformanceJob[]): DisputeFigure {
  const disputes = finished.filter((job) => job.disputeCases > 0).length;
  return { disputes, totalJobs: finished.length, percent: percent(disputes, finished.length, 1) };
}

function attendanceFigures(input: PerformanceFigureInput): { attendance: AttendanceFigure; noShowRate: NoShowFigure } {
  const due = input.jobs.filter(
    (job) => sydneyDateKey(job.scheduledDate) < input.todayKey && job.status !== "CANCELLED" && job.cleanSkipStatus !== "SKIPPED",
  );
  let attended = 0;
  let noShows = 0;
  for (const job of due) {
    const present = job.clockIns.length > 0 || job.submissions.some((submission) => submission.submittedById === input.userId);
    if (present) attended += 1;
    else if (NOT_STARTED_STATUSES.has(job.status)) noShows += 1;
  }
  const known = attended + noShows;
  const notRecorded = due.length - known;
  return {
    attendance: { completedJobs: attended, assignedJobs: known, percent: percent(attended, known), dueJobs: due.length, notRecorded },
    noShowRate: { noShows, scheduled: known, percent: percent(noShows, known, 1), notRecorded },
  };
}

function replyFigure(offers: readonly PerformanceOffer[], now: Date): ReplyFigure {
  const hourAgo = now.getTime() - REPLY_WITHIN_MINUTES * 60_000;
  let officeAccepted = 0;
  let counted = 0;
  let replied = 0;
  for (const offer of offers) {
    if (offer.offeredAt.getTime() > hourAgo) continue;
    const answeredAfterMs = offer.respondedAt ? offer.respondedAt.getTime() - offer.offeredAt.getTime() : null;
    if (offer.responseStatus === "ACCEPTED" && answeredAfterMs !== null && answeredAfterMs < OFFICE_ACCEPTED_SECONDS * 1000) {
      officeAccepted += 1;
      continue;
    }
    counted += 1;
    const isReply = answeredAfterMs !== null && offer.responseStatus !== "PENDING" && offer.responseNote !== ACCEPTED_ON_JOB_START_NOTE;
    if (isReply && answeredAfterMs! <= REPLY_WITHIN_MINUTES * 60_000) replied += 1;
  }
  return { acceptedPercent: percent(replied, counted), sampleSize: counted, repliedWithinHour: replied, officeAccepted };
}

export function computeJobPerformanceFigures(input: PerformanceFigureInput): JobPerformanceFigures {
  const finished = input.jobs.filter(isFinishedJob);
  const { reliability, punctuality } = startFigures(finished);
  const { attendance, noShowRate } = attendanceFigures(input);
  return {
    finishedJobs: finished.length,
    quality: qualityFigure(finished),
    reliability,
    punctuality,
    attendance,
    documentation: documentationFigure(finished),
    customerSatisfaction: ratingFigure(finished),
    responseRate: replyFigure(input.offers, input.now),
    disputeRate: disputeFigure(finished),
    noShowRate,
  };
}
