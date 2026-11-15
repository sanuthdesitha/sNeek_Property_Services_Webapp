// @vitest-environment node
/**
 * Cleaner performance figures against a real database (owner report
 * 2026-11-15). Seeds one fixture cleaner (rows prefixed `perf-`) with the
 * mixed history the page has to read correctly, runs getPerformanceMetrics
 * and asserts every figure with its denominator. Needs the disposable
 * loopback database on port 55439 (SNEEK_TEST_DATABASE_URL); skipped without.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }),
}));
vi.mock("@/lib/settings", () => ({
  getAppSettings: async () => ({ timezone: "Australia/Sydney", accountability: { bonuses: { streakMinScore: 97 } } }),
}));

import { getPerformanceMetrics } from "@/lib/workforce/performance";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const NOW = new Date("2026-11-15T02:00:00.000Z"); // 1 pm Sydney
const ME = "perf-cleaner";
const MATE = "perf-teammate";
const ADMIN = "perf-admin";
const CLIENT = "perf-client";
const PROPERTY = "perf-property";
const TEMPLATE = "perf-template";

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

type JobSeed = {
  id: string;
  key: string;
  status?: string;
  startTime?: string | null;
  skip?: boolean;
  removed?: boolean;
  team?: boolean;
  myClockIns?: string[];
  mateClockIns?: string[];
  form?: { by: string; photos: number };
  reviews?: Array<{ score: number; kind: string; at: string }>;
  cases?: Array<{ caseType: string; state?: string }>;
  feedback?: number;
  satisfaction?: number;
  payAdjustment?: boolean;
};

const JOBS: JobSeed[] = [
  { id: "perf-dst-before", key: "2026-10-03", myClockIns: ["2026-10-02T22:55:00Z", "2026-10-03T02:00:00Z"], form: { by: ME, photos: 3 }, reviews: [{ score: 90, kind: "QA", at: "2026-10-04T00:00:00Z" }], feedback: 4 },
  { id: "perf-dst-after", key: "2026-10-05", myClockIns: ["2026-10-04T22:10:00Z"], form: { by: ME, photos: 5 }, reviews: [{ score: 80, kind: "AUTO", at: "2026-10-06T00:00:00Z" }, { score: 70, kind: "QA", at: "2026-10-05T08:00:00Z" }] },
  { id: "perf-late", key: "2026-11-02", status: "INVOICED", startTime: "08:00", myClockIns: ["2026-11-01T21:40:00Z"], form: { by: ME, photos: 0 }, cases: [{ caseType: "CLIENT_DISPUTE" }, { caseType: "OPS" }], satisfaction: 2 },
  { id: "perf-no-form-1", key: "2026-11-03", startTime: "10:00", myClockIns: ["2026-11-02T23:00:00Z"], cases: [{ caseType: "DAMAGE" }, { caseType: "SLA" }, { caseType: "CLIENT_DISPUTE", state: "CANCELLED" }], payAdjustment: true },
  { id: "perf-no-form-2", key: "2026-11-04", startTime: null, myClockIns: ["2026-11-03T22:00:00Z"], cases: [{ caseType: "LOST_FOUND" }], payAdjustment: true },
  { id: "perf-no-clock", key: "2026-11-05", form: { by: ME, photos: 2 } },
  { id: "perf-team", key: "2026-11-06", team: true, myClockIns: ["2026-11-05T22:05:00Z"], mateClockIns: ["2026-11-05T21:00:00Z"], form: { by: MATE, photos: 6 }, reviews: [{ score: 85, kind: "ADMIN", at: "2026-11-06T09:00:00Z" }], feedback: 5 },
  { id: "perf-cancelled", key: "2026-11-07", status: "CANCELLED", cases: [{ caseType: "CLIENT_DISPUTE" }] },
  { id: "perf-skipped", key: "2026-11-08", skip: true, form: { by: ME, photos: 1 } },
  { id: "perf-no-show", key: "2026-11-09", status: "ASSIGNED" },
  { id: "perf-unrecorded", key: "2026-11-10", status: "IN_PROGRESS", team: true, mateClockIns: ["2026-11-09T22:00:00Z"] },
  // Removed from the job: it is not theirs, whatever happened on it.
  { id: "perf-removed", key: "2026-11-11", removed: true, myClockIns: ["2026-11-10T23:00:00Z"], cases: [{ caseType: "CLIENT_DISPUTE" }] },
  { id: "perf-future", key: "2026-11-20", status: "ASSIGNED" },
  // Outside the 90-day window.
  { id: "perf-old", key: "2026-08-01", myClockIns: ["2026-07-31T23:00:00Z"], cases: [{ caseType: "CLIENT_DISPUTE" }] },
];

const minutesAfter = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000);

async function seed(db: PrismaClient) {
  await db.user.createMany({
    data: [
      { id: ME, email: "perf-cleaner@example.invalid", name: "Perf Cleaner", role: "CLEANER" },
      { id: MATE, email: "perf-teammate@example.invalid", name: "Perf Teammate", role: "CLEANER" },
      { id: ADMIN, email: "perf-admin@example.invalid", name: "Perf Admin", role: "ADMIN" },
    ],
  });
  await db.client.create({ data: { id: CLIENT, name: "Perf client" } });
  await db.property.create({ data: { id: PROPERTY, clientId: CLIENT, name: "Perf property", address: "1 Fixture St", suburb: "Fixture" } });
  await db.formTemplate.create({ data: { id: TEMPLATE, name: "Perf form", serviceType: "AIRBNB_TURNOVER", isActive: false, schema: {} } });
  for (const seedJob of JOBS) {
    const assignedAt = minutesAfter(`${seedJob.key}T00:00:00Z`, -3 * 24 * 60);
    await db.job.create({
      data: {
        id: seedJob.id,
        jobNumber: seedJob.id,
        propertyId: PROPERTY,
        jobType: "AIRBNB_TURNOVER",
        status: (seedJob.status ?? "COMPLETED") as never,
        scheduledDate: day(seedJob.key),
        startTime: seedJob.startTime === undefined ? "09:00" : seedJob.startTime,
        cleanSkipStatus: seedJob.skip ? "SKIPPED" : "NONE",
        assignments: {
          create: [
            { userId: ME, assignedAt, offeredAt: assignedAt, removedAt: seedJob.removed ? assignedAt : null, responseStatus: "ACCEPTED", respondedAt: minutesAfter(assignedAt.toISOString(), 30) },
            ...(seedJob.team ? [{ userId: MATE, assignedAt, offeredAt: assignedAt, responseStatus: "ACCEPTED" as const, respondedAt: minutesAfter(assignedAt.toISOString(), 200) }] : []),
          ],
        },
      },
    });
    for (const startedAt of seedJob.myClockIns ?? []) await db.timeLog.create({ data: { jobId: seedJob.id, userId: ME, startedAt: new Date(startedAt), stoppedAt: minutesAfter(startedAt, 60), durationM: 60 } });
    for (const startedAt of seedJob.mateClockIns ?? []) await db.timeLog.create({ data: { jobId: seedJob.id, userId: MATE, startedAt: new Date(startedAt), stoppedAt: minutesAfter(startedAt, 60), durationM: 60 } });
    if (seedJob.form) {
      await db.formSubmission.create({
        data: {
          jobId: seedJob.id,
          templateId: TEMPLATE,
          submittedById: seedJob.form.by,
          data: {},
          media: { create: Array.from({ length: seedJob.form.photos }, (_, i) => ({ fieldId: "photos", mediaType: "PHOTO" as const, url: `perf/${seedJob.id}/${i}.jpg`, s3Key: `perf/${seedJob.id}/${i}.jpg` })) },
        },
      });
    }
    for (const review of seedJob.reviews ?? []) await db.qAReview.create({ data: { jobId: seedJob.id, score: review.score, passed: review.score >= 70, kind: review.kind, createdAt: new Date(review.at) } });
    for (const issue of seedJob.cases ?? []) await db.issueTicket.create({ data: { jobId: seedJob.id, clientId: CLIENT, title: `perf ${issue.caseType}`, caseType: issue.caseType, state: (issue.state ?? "OPEN") as never } });
    if (seedJob.feedback) await db.jobFeedback.create({ data: { jobId: seedJob.id, clientId: CLIENT, rating: seedJob.feedback, submittedAt: day(seedJob.key), tokenExpiresAt: day("2027-01-01") } });
    if (seedJob.satisfaction) await db.clientSatisfactionRating.create({ data: { jobId: seedJob.id, clientId: CLIENT, score: seedJob.satisfaction } });
    if (seedJob.payAdjustment) await db.cleanerPayAdjustment.create({ data: { jobId: seedJob.id, cleanerId: ME, type: "FIXED", requestedAmount: 20 } });
  }
}

async function cleanup(db: PrismaClient) {
  const jobIds = JOBS.map((seedJob) => seedJob.id);
  await db.cleanerPayAdjustment.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.issueTicket.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.jobFeedback.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.clientSatisfactionRating.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.qAReview.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.submissionMedia.deleteMany({ where: { submission: { jobId: { in: jobIds } } } });
  await db.formSubmission.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.timeLog.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } });
  await db.auditLog.deleteMany({ where: { jobId: { in: jobIds } } }).catch(() => undefined);
  await db.job.deleteMany({ where: { id: { in: jobIds } } });
  await db.formTemplate.deleteMany({ where: { id: TEMPLATE } });
  await db.property.deleteMany({ where: { id: PROPERTY } });
  await db.client.deleteMany({ where: { id: CLIENT } });
  await db.user.deleteMany({ where: { id: { in: [ME, MATE, ADMIN] } } });
}

describe.skipIf(!url)("cleaner performance figures from a real database", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await cleanup(m.client);
    await seed(m.client);
  });
  afterAll(async () => {
    await cleanup(m.client);
    await m.client.$disconnect();
  });

  it("works out every 90-day figure over the right jobs, with its denominator", async () => {
    const f = await getPerformanceMetrics(ME, 90, NOW);
    expect(f.finishedJobs).toBe(7);
    expect(f.quality).toEqual({ score: 81.7, sampleSize: 3, jobs: 7 });
    expect(f.reliability).toEqual({ onTimePercent: 80, sampleSize: 5, onTime: 4, jobs: 7, noClockIn: 1, noStartTime: 1 });
    expect(f.punctuality).toEqual({ avgMinutesLate: 10, sampleSize: 5, jobs: 7, noClockIn: 1, noStartTime: 1 });
    expect(f.documentation).toEqual({ fullyDocumentedPercent: 57, sampleSize: 7, documented: 4, withoutForm: 2, formWithoutPhotos: 1 });
    // One client dispute; operations, damage, SLA, lost property, a cancelled dispute and pay adjustments are not disputes.
    expect(f.disputeRate).toEqual({ disputes: 1, totalJobs: 7, percent: 14.3 });
    expect(f.customerSatisfaction.sampleSize).toBe(3);
    expect(f.customerSatisfaction.avgRating).toBeCloseTo(11 / 3, 5);
    expect(f.attendance).toEqual({ completedJobs: 7, assignedJobs: 8, percent: 88, dueJobs: 9, notRecorded: 1 });
    expect(f.noShowRate).toEqual({ noShows: 1, scheduled: 8, percent: 12.5, notRecorded: 1 });
    // Every assignment was answered 30 minutes after it was made, including the removed one.
    expect(f.responseRate).toMatchObject({ acceptedPercent: 100, repliedWithinHour: f.responseRate.sampleSize, officeAccepted: 0 });
    expect(f.responseRate.sampleSize).toBe(12);
    expect(f.reworkRate.totalJobs).toBe(7);
  });

  it("the 30-day window holds only the November jobs", async () => {
    const f = await getPerformanceMetrics(ME, 30, NOW);
    // late, no-form-1, no-form-2, no-clock, team.
    expect(f.finishedJobs).toBe(5);
    expect(f.documentation).toMatchObject({ documented: 2, withoutForm: 2, formWithoutPhotos: 1, fullyDocumentedPercent: 40 });
    expect(f.reliability).toMatchObject({ onTimePercent: 67, onTime: 2, sampleSize: 3, noClockIn: 1, noStartTime: 1 });
    expect(f.punctuality.avgMinutesLate).toBe(15);
    expect(f.quality).toEqual({ score: null, sampleSize: 1, jobs: 5 });
  });
});
