// @vitest-environment node
/**
 * Cause #1 of "cleaners getting constant emails" (2026-11-15): the hourly
 * qa-auto-score sweep re-scored a job whose automatic score FAILED. A failed
 * score puts the job back in QA_REVIEW, which the sweep scores, so every run
 * filed another AUTO review and sent the cleaner the "QA needs attention"
 * inbox, push, email and SMS again, until somebody inspected the job.
 * Each submission is now auto-scored once.
 */
import { beforeEach, expect, it, vi } from "vitest";


const m = vi.hoisted(() => {
  const submittedAt = new Date("2026-11-10T01:00:00Z");
  const state = {
    reviews: [] as Array<{ id: string; jobId: string; kind: string; createdAt: Date; score: number; passed: boolean }>,
    clock: 0,
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    formSubmission: { findFirst: vi.fn(async () => ({ createdAt: submittedAt })) },
    qAReview: {
      findFirst: vi.fn(async ({ where }: { where: { jobId: string; kind: { in: string[] }; createdAt?: { gte: Date } } }) =>
        state.reviews.find((review) => review.jobId === where.jobId && where.kind.in.includes(review.kind) && (!where.createdAt || review.createdAt >= where.createdAt.gte)) ?? null),
      create: vi.fn(async ({ data }: { data: { jobId: string; kind: string; score: number; passed: boolean } }) => {
        state.clock += 1;
        const review = { ...data, id: `r${state.reviews.length + 1}`, createdAt: new Date(Date.parse("2026-11-12T00:00:00Z") + state.clock * 1000) };
        state.reviews.push(review);
        return review;
      }),
    },
    auditLog: { create: vi.fn() },
  };
  // Only one transaction at a time, like the per-job advisory lock.
  let chain: Promise<unknown> = Promise.resolve();
  const transaction = (fn: (client: typeof tx) => Promise<unknown>) => {
    const next = chain.then(() => fn(tx));
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    state, tx, transaction, submittedAt,
    notify: vi.fn(async () => undefined),
    recompute: vi.fn(async () => ({ status: "QA_REVIEW", passed: false, score: 40 })),
  };
});

const job = {
  id: "job-1", jobNumber: "J-1", status: "QA_REVIEW", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-10T00:00:00Z"),
  property: { name: "House", suburb: "Bondi", hasBalcony: false }, assignments: [{ user: { name: "Cleaner" } }],
  formSubmissions: [{ createdAt: m.submittedAt, data: {}, media: [] }],
};

vi.mock("@/lib/db", () => ({
  db: {
    // The sweep's candidate query: still a candidate, as in the database (QA_REVIEW, no QA-kind review).
    job: { findMany: vi.fn(async () => [job]), findUnique: vi.fn(async () => ({ id: "job-1", status: "QA_REVIEW", qaReviews: [] })) },
    $transaction: m.transaction,
    formSubmission: m.tx.formSubmission,
    qAReview: m.tx.qAReview,
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ qaAutomation: { autoScoreEnabled: true, autoScoreAfterHours: 24, failureThreshold: 80 } }) }));
vi.mock("@/lib/qa/authority", () => ({ recomputeJobQaOutcome: m.recompute }));
vi.mock("@/lib/qa/suggested-score", () => ({ suggestQaScore: () => ({ score: 40, summary: "Missing photos." }) }));
vi.mock("@/lib/client/rewards", () => ({ awardLoyaltyForCompletedJob: vi.fn() }));
vi.mock("@/lib/ops/follow-up-sequences", () => ({ scheduleJobFollowUps: vi.fn() }));
vi.mock("@/lib/notifications/accountability", () => ({ notifyQaResultToCleaner: m.notify }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { applyQuickQaScore, runQaAutoScoreSweep } from "@/lib/qa/auto-score";

beforeEach(() => {
  m.state.reviews.length = 0;
  m.state.clock = 0;
  m.notify.mockClear();
  m.recompute.mockClear();
});

it("scores a failed submission once and tells the cleaner once, however many hourly runs follow", async () => {
  const now = new Date("2026-11-12T00:00:00Z");
  for (let hour = 0; hour < 3; hour += 1) await runQaAutoScoreSweep({ now: new Date(now.getTime() + hour * 3_600_000) });
  expect(m.state.reviews.filter((review) => review.kind === "AUTO")).toHaveLength(1);
  expect(m.notify).toHaveBeenCalledTimes(1);
  expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", passed: false }));
});

it("re-checks under the per-job lock, so two overlapping sweeps cannot both file and notify", async () => {
  const [first, second] = await Promise.all([
    applyQuickQaScore({ jobId: "job-1", score: 40, kind: "AUTO" }),
    applyQuickQaScore({ jobId: "job-1", score: 40, kind: "AUTO" }),
  ]);
  expect([first.ok, second.ok].sort()).toEqual([false, true]);
  expect([first, second].find((result) => !result.ok)).toMatchObject({ reason: "ALREADY_SCORED" });
  expect(m.notify).toHaveBeenCalledTimes(1);
});

it("scores again only after a new submission (a rework), and never blocks an administrator's own quick score", async () => {
  await runQaAutoScoreSweep({ now: new Date("2026-11-12T00:00:00Z") });
  // An administrator may still score by hand.
  expect(await applyQuickQaScore({ jobId: "job-1", score: 90, kind: "ADMIN", actorUserId: "admin" })).toMatchObject({ ok: true });
  // A newer submission (rework) is a new thing to score.
  m.tx.formSubmission.findFirst.mockResolvedValueOnce({ createdAt: new Date("2026-11-13T00:00:00Z") }).mockResolvedValueOnce({ createdAt: new Date("2026-11-13T00:00:00Z") });
  await runQaAutoScoreSweep({ now: new Date("2026-11-14T00:00:00Z") });
  expect(m.state.reviews.filter((review) => review.kind === "AUTO")).toHaveLength(2);
});
