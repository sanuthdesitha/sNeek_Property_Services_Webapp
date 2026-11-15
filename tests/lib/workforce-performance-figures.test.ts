/**
 * Cleaner performance figures (owner report 2026-11-15, "these insights are
 * wrong as the cleaner haven't submitted lots of forms for jobs"). A fixture
 * cleaner with completed jobs without a form, jobs without a clock-in, Sydney
 * clock-ins either side of the October 2026 daylight-saving change, team
 * jobs, cancelled / skipped jobs and a mix of offers; every figure and its
 * denominator is asserted.
 */
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_ON_JOB_START_NOTE,
  computeJobPerformanceFigures,
  startDelay,
  type PerformanceJob,
  type PerformanceOffer,
} from "@/lib/workforce/performance-figures";

const ME = "perf-cleaner";
const MATE = "perf-teammate";
const TODAY = "2026-11-15";
const NOW = new Date("2026-11-15T02:00:00.000Z"); // 1 pm Sydney (AEDT)

/** Jobs are stored at UTC midnight of their calendar day (lib/ops/recurring toUtcDateOnly). */
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const mine = (photoCount: number) => ({ submittedById: ME, photoCount });

function job(id: string, overrides: Partial<PerformanceJob>): PerformanceJob {
  return {
    jobId: id,
    status: "COMPLETED",
    scheduledDate: day("2026-11-01"),
    startTime: "09:00",
    cleanSkipStatus: "NONE",
    clockIns: [],
    submissions: [],
    reviews: [],
    disputeCases: 0,
    rating: null,
    ...overrides,
  };
}

const JOBS: PerformanceJob[] = [
  // (c) 3 Oct is AEST (+10): 08:55 Sydney = 22:55 UTC the day before. 5 min early.
  job("dst-before", {
    scheduledDate: day("2026-10-03"),
    clockIns: [new Date("2026-10-02T22:55:00.000Z"), new Date("2026-10-03T02:00:00.000Z")],
    submissions: [mine(3)],
    reviews: [{ score: 90, kind: "QA", createdAt: new Date("2026-10-04T00:00:00Z") }],
    rating: 4,
  }),
  // (c) 5 Oct is AEDT (+11): 09:10 Sydney = 22:10 UTC the day before. 10 min late, on time.
  job("dst-after", {
    scheduledDate: day("2026-10-05"),
    clockIns: [new Date("2026-10-04T22:10:00.000Z")],
    submissions: [mine(5)],
    reviews: [
      { score: 80, kind: "AUTO", createdAt: new Date("2026-10-06T00:00:00Z") },
      { score: 70, kind: "QA", createdAt: new Date("2026-10-05T08:00:00Z") },
    ],
  }),
  // 08:40 Sydney against an 08:00 start: 40 min late. Form without photos. (d) one real dispute.
  job("late", {
    status: "INVOICED",
    scheduledDate: day("2026-11-02"),
    startTime: "08:00",
    clockIns: [new Date("2026-11-01T21:40:00.000Z")],
    submissions: [mine(0)],
    disputeCases: 1,
    rating: 2,
  }),
  // (a) completed with no form at all.
  job("no-form-1", { scheduledDate: day("2026-11-03"), startTime: "10:00", clockIns: [new Date("2026-11-02T23:00:00.000Z")] }),
  // (a) no form, and no start time: no punctuality figure from it.
  job("no-form-2", { scheduledDate: day("2026-11-04"), startTime: null, clockIns: [new Date("2026-11-03T22:00:00.000Z")] }),
  // (b) form with photos but no clock-in: not "on time", no punctuality figure.
  job("no-clock", { scheduledDate: day("2026-11-05"), submissions: [mine(2)] }),
  // (e) team job: the teammate submitted the one shared form; my own clock-in 09:05.
  job("team", {
    scheduledDate: day("2026-11-06"),
    clockIns: [new Date("2026-11-05T22:05:00.000Z")],
    submissions: [{ submittedById: MATE, photoCount: 6 }],
    reviews: [{ score: 85, kind: "ADMIN", createdAt: new Date("2026-11-06T09:00:00Z") }],
    rating: 5,
  }),
  // (f) cancelled and skipped jobs count nowhere, even with a dispute or a form.
  job("cancelled", { status: "CANCELLED", scheduledDate: day("2026-11-07"), disputeCases: 1 }),
  job("skipped", { scheduledDate: day("2026-11-08"), cleanSkipStatus: "SKIPPED", submissions: [mine(1)] }),
  // Never started and its day has passed: a no-show.
  job("no-show", { status: "ASSIGNED", scheduledDate: day("2026-11-09") }),
  // Started by someone with no record of me: attendance not recorded.
  job("unrecorded", { status: "IN_PROGRESS", scheduledDate: day("2026-11-10") }),
  // Today and the future are not due yet.
  job("today", { status: "ASSIGNED", scheduledDate: day(TODAY) }),
  job("future", { status: "ASSIGNED", scheduledDate: day("2026-11-20") }),
];

const at = (iso: string) => new Date(iso);
const minutesAfter = (iso: string, minutes: number) => new Date(at(iso).getTime() + minutes * 60_000);
const OFFERS: PerformanceOffer[] = [
  { offeredAt: at("2026-11-01T00:00:00Z"), respondedAt: minutesAfter("2026-11-01T00:00:00Z", 30), responseStatus: "ACCEPTED", responseNote: null },
  { offeredAt: at("2026-11-02T00:00:00Z"), respondedAt: minutesAfter("2026-11-02T00:00:00Z", 20), responseStatus: "DECLINED", responseNote: "Busy" },
  { offeredAt: at("2026-11-03T00:00:00Z"), respondedAt: minutesAfter("2026-11-03T00:00:00Z", 180), responseStatus: "ACCEPTED", responseNote: null },
  { offeredAt: at("2026-11-04T00:00:00Z"), respondedAt: null, responseStatus: "PENDING", responseNote: null },
  { offeredAt: at("2026-11-05T00:00:00Z"), respondedAt: minutesAfter("2026-11-05T00:00:00Z", 10), responseStatus: "ACCEPTED", responseNote: ACCEPTED_ON_JOB_START_NOTE },
  // Put straight onto them by the office (rework): accepted the instant it was made.
  { offeredAt: at("2026-11-06T00:00:00Z"), respondedAt: at("2026-11-06T00:00:00.001Z"), responseStatus: "ACCEPTED", responseNote: null },
  // Offered 30 minutes ago: its hour has not passed.
  { offeredAt: minutesAfter(NOW.toISOString(), -30), respondedAt: null, responseStatus: "PENDING", responseNote: null },
];

describe("cleaner performance figures, fixture cleaner", () => {
  const f = computeJobPerformanceFigures({ userId: ME, todayKey: TODAY, jobs: JOBS, offers: OFFERS, now: NOW });

  it("counts finished jobs only: submitted or later, not cancelled, not skipped", () => {
    expect(f.finishedJobs).toBe(7);
  });

  it("quality: deciding review per job (QA over ADMIN over AUTO), over reviewed jobs", () => {
    expect(f.quality).toEqual({ score: 81.7, sampleSize: 3, jobs: 7 });
  });

  it("on time: own first clock-in within 15 minutes of the Sydney start; no clock-in or no start time is left out and counted", () => {
    expect(f.reliability).toEqual({ onTimePercent: 80, sampleSize: 5, onTime: 4, jobs: 7, noClockIn: 1, noStartTime: 1 });
  });

  it("punctuality: average over the same jobs, Sydney time across daylight saving", () => {
    expect(f.punctuality).toEqual({ avgMinutesLate: 10, sampleSize: 5, jobs: 7, noClockIn: 1, noStartTime: 1 });
  });

  it("photos and forms: out of ALL finished jobs; a job without a form counts against it; the shared team form counts", () => {
    expect(f.documentation).toEqual({ fullyDocumentedPercent: 57, sampleSize: 7, documented: 4, withoutForm: 2, formWithoutPhotos: 1 });
  });

  it("disputes: finished jobs with a client dispute case", () => {
    expect(f.disputeRate).toEqual({ disputes: 1, totalJobs: 7, percent: 14.3 });
  });

  it("client rating: one rating per finished job", () => {
    expect(f.customerSatisfaction.sampleSize).toBe(3);
    expect(f.customerSatisfaction.jobs).toBe(7);
    expect(f.customerSatisfaction.avgRating).toBeCloseTo(11 / 3, 5);
  });

  it("attendance and no-shows share one set of past jobs and add up to 100%", () => {
    expect(f.attendance).toEqual({ completedJobs: 7, assignedJobs: 8, percent: 88, dueJobs: 9, notRecorded: 1 });
    expect(f.noShowRate).toEqual({ noShows: 1, scheduled: 8, percent: 12.5, notRecorded: 1 });
    expect(f.attendance.completedJobs + f.noShowRate.noShows).toBe(f.attendance.assignedJobs);
  });

  it("replies within 1 hour: any answer counts, starting the job is not a reply, office assignments and unexpired offers are left out", () => {
    expect(f.responseRate).toEqual({ acceptedPercent: 40, sampleSize: 5, repliedWithinHour: 2, officeAccepted: 1 });
  });
});

describe("scheduled start is Sydney time on the job's Sydney day", () => {
  it("gives the same delay for the same local clock-in either side of the daylight-saving change", () => {
    const before = startDelay(job("x", { scheduledDate: day("2026-10-03"), clockIns: [new Date("2026-10-02T22:55:00Z")] }));
    const after = startDelay(job("y", { scheduledDate: day("2026-10-05"), clockIns: [new Date("2026-10-04T21:55:00Z")] }));
    expect(before).toEqual({ minutes: -5 });
    expect(after).toEqual({ minutes: -5 });
  });

  it("reads a job stored at Sydney midnight the same as one stored at UTC midnight", () => {
    const sydneyMidnight = new Date("2026-11-04T13:00:00.000Z"); // 5 Nov 00:00 AEDT
    expect(startDelay(job("z", { scheduledDate: sydneyMidnight, clockIns: [new Date("2026-11-04T22:00:00Z")] }))).toEqual({ minutes: 0 });
  });

  it("has no delay without a start time or without a clock-in", () => {
    expect(startDelay(job("a", { startTime: null, clockIns: [new Date()] }))).toEqual({ missing: "no_start_time" });
    expect(startDelay(job("b", { clockIns: [] }))).toEqual({ missing: "no_clock_in" });
  });
});

describe("below the minimum sample a figure is not shown, its counts are", () => {
  it("two finished jobs give no rates but keep their denominators", () => {
    const two = computeJobPerformanceFigures({
      userId: ME,
      todayKey: TODAY,
      jobs: [JOBS[0], JOBS[1]],
      offers: [],
      now: NOW,
    });
    expect(two.reliability).toMatchObject({ onTimePercent: null, sampleSize: 2, onTime: 2 });
    expect(two.punctuality.avgMinutesLate).toBeNull();
    expect(two.documentation).toMatchObject({ fullyDocumentedPercent: null, documented: 2, sampleSize: 2 });
    expect(two.disputeRate).toEqual({ disputes: 0, totalJobs: 2, percent: null });
    expect(two.quality).toEqual({ score: null, sampleSize: 2, jobs: 2 });
    expect(two.responseRate).toEqual({ acceptedPercent: null, sampleSize: 0, repliedWithinHour: 0, officeAccepted: 0 });
  });
});

/**
 * Regression: the owner's screenshot (30 days) showed Photos and forms 100%,
 * "498 min early" with On time 100%, Disputes 77% (23 of 30), Attendance 47%
 * with No-shows 3%. A cleaner like theirs: 30 finished jobs at 09:00 Sydney,
 * clocked in 5 minutes early on 24 of them, a form on only 10, operations and
 * damage cases (not disputes) on 23, plus 14 more assigned jobs still ahead.
 */
describe("owner regression: the impossible combinations cannot recur", () => {
  const jobs: PerformanceJob[] = [];
  for (let i = 0; i < 30; i += 1) {
    const key = `2026-10-${String(17 + (i % 14)).padStart(2, "0")}`;
    const clockedIn = i < 24;
    jobs.push(
      job(`done-${i}`, {
        scheduledDate: day(key),
        // 08:55 AEDT = 21:55 UTC the day before.
        clockIns: clockedIn ? [new Date(`${new Date(day(key).getTime() - 86_400_000).toISOString().slice(0, 10)}T21:55:00.000Z`)] : [],
        submissions: i < 10 ? [mine(4)] : [],
        // The loader only passes client disputes; the 23 operations / damage cases are not.
        disputeCases: 0,
      }),
    );
  }
  for (let i = 0; i < 14; i += 1) jobs.push(job(`ahead-${i}`, { status: "ASSIGNED", scheduledDate: day(`2026-11-${String(16 + i).padStart(2, "0")}`) }));
  const f = computeJobPerformanceFigures({ userId: ME, todayKey: TODAY, jobs, offers: [], now: NOW });

  it("photos and forms reflect the missing forms", () => {
    expect(f.documentation).toMatchObject({ fullyDocumentedPercent: 33, documented: 10, withoutForm: 20, sampleSize: 30 });
  });

  it("punctuality agrees with on time: 5 minutes early, not 8 hours", () => {
    expect(f.punctuality.avgMinutesLate).toBe(-5);
    expect(f.reliability).toMatchObject({ onTimePercent: 100, sampleSize: 24, noClockIn: 6 });
  });

  it("cases that are not client disputes are not disputes", () => {
    expect(f.disputeRate).toEqual({ disputes: 0, totalJobs: 30, percent: 0 });
  });

  it("future jobs do not drag attendance down; attendance and no-shows describe the same jobs", () => {
    // The 6 finished jobs with neither their clock-in nor their form are "not recorded", not attended.
    expect(f.attendance).toMatchObject({ completedJobs: 24, assignedJobs: 24, percent: 100, dueJobs: 30, notRecorded: 6 });
    expect(f.noShowRate).toMatchObject({ noShows: 0, scheduled: 24, percent: 0, notRecorded: 6 });
    expect((f.attendance.percent ?? 0) + (f.noShowRate.percent ?? 0)).toBe(100);
  });
});
