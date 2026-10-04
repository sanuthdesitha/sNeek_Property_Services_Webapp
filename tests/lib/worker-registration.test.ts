// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  handlers: new Map<string, (job?: unknown) => Promise<void>>(),
  calls: new Map<string, ReturnType<typeof vi.fn>>(),
  call(name: string) { if (!this.calls.has(name)) this.calls.set(name, vi.fn()); return this.calls.get(name)!; },
  schedule: vi.fn(), start: vi.fn(), on: vi.fn(), construct: vi.fn(),
  info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  timeLogs: vi.fn(), cleanup: vi.fn(),
}));
vi.mock("pg-boss", () => ({ default: class {
  constructor(url: string) { m.construct(url); }
  on = m.on; start = m.start; schedule = m.schedule;
  async work(name: string, handler: (job?: unknown) => Promise<void>) { m.handlers.set(name, handler); }
} }));
vi.mock("@/lib/db", () => ({ db: { timeLog: { findMany: m.timeLogs }, cleanerLocationPing: { deleteMany: m.cleanup } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: m.info, warn: m.warn, error: m.error } }));
vi.mock('@/lib/ical/sync', () => ({ syncAllIcal: m.call('syncAllIcal') }));
vi.mock('@/lib/job-tasks/service', () => ({ autoApprovePendingClientJobTasks: m.call('autoApprovePendingClientJobTasks') }));
vi.mock('@/lib/cases/follow-up', () => ({ sendStaleCaseFollowUps: m.call('sendStaleCaseFollowUps') }));
vi.mock('@/lib/laundry/planner', () => ({ buildLaundryPlanDraft: m.call('buildLaundryPlanDraft') }));
vi.mock('@/lib/ops/daily-briefing', () => ({ sendDailyOpsBriefing: m.call('sendDailyOpsBriefing') }));
vi.mock('@/lib/ops/follow-up-sequences', () => ({ dispatchJobFollowUp: m.call('dispatchJobFollowUp') }));
vi.mock('@/lib/ops/reminders', () => ({ dispatchJobReminders: m.call('dispatchJobReminders') }));
vi.mock('@/lib/ops/admin-attention-summary', () => ({ sendAdminAttentionSummary: m.call('sendAdminAttentionSummary') }));
vi.mock('@/lib/ops/recurring', () => ({ generateRecurringJobs: m.call('generateRecurringJobs') }));
vi.mock('@/lib/ops/safety-checkins', () => ({ runSafetyCheckinAlerts: m.call('runSafetyCheckinAlerts') }));
vi.mock('@/lib/ops/sla', () => ({ runSlaEscalation: m.call('runSlaEscalation') }));
vi.mock('@/lib/ops/stock-alerts', () => ({ sendStockAlerts: m.call('sendStockAlerts') }));
vi.mock('@/lib/ops/tomorrow-prep', () => ({ dispatchTomorrowPrepSummaries: m.call('dispatchTomorrowPrepSummaries') }));
vi.mock('@/lib/marketing/email-campaigns', () => ({ dispatchScheduledEmailCampaigns: m.call('dispatchScheduledEmailCampaigns') }));
vi.mock('@/lib/public-site/google-reviews', () => ({ refreshGoogleReviewsCache: m.call('refreshGoogleReviewsCache') }));
vi.mock('@/lib/reports/generator', () => ({ generateJobReport: m.call('generateJobReport') }));
vi.mock('@/lib/settings', () => ({ getAppSettings: m.call('getAppSettings') }));
vi.mock('@/lib/workforce/service', () => ({ dispatchScheduledWorkforcePosts: m.call('dispatchScheduledWorkforcePosts'), runCredentialExpiryCheck: m.call('runCredentialExpiryCheck'), runDocumentExpiryCheck: m.call('runDocumentExpiryCheck'), runRecognitionCheck: m.call('runRecognitionCheck') }));
vi.mock('@/lib/notifications/client-automation', () => ({ dispatchClientPostJobAutomationRule: m.call('dispatchClientPostJobAutomationRule') }));
vi.mock('@/lib/accountability/streaks', () => ({ runAccountabilityNightly: m.call('runAccountabilityNightly') }));
vi.mock('@/lib/ops/cleaner-day-reminders', () => ({ dispatchCleanerDayReminders: m.call('dispatchCleanerDayReminders') }));
vi.mock('@/lib/ops/pending-pay-approval-reminders', () => ({ sendPendingPayApprovalReminders: m.call('sendPendingPayApprovalReminders') }));
vi.mock('@/lib/ops/stale-en-route', () => ({ sweepStaleEnRouteJobs: m.call('sweepStaleEnRouteJobs') }));
vi.mock('@/lib/ops/auto-pause', () => ({ autoPauseStaleJobs: m.call('autoPauseStaleJobs') }));
vi.mock('@/lib/ops/unfinished-reminders', () => ({ dispatchUnfinishedJobPushReminders: m.call('dispatchUnfinishedJobPushReminders') }));
vi.mock('@/lib/laundry/reminders', () => ({ dispatchLaundryDriverNudges: m.call('dispatchLaundryDriverNudges') }));
vi.mock('@/lib/ops/missed-clock-in-sweep', () => ({ runMissedClockInSweep: m.call('runMissedClockInSweep') }));
vi.mock('@/lib/notifications/mobile-outbox', () => ({ dispatchMobileOutbox: m.call('dispatchMobileOutbox') }));
vi.mock('@/lib/cleaner/submission-followups', () => ({ processSubmissionFollowups: m.call('processSubmissionFollowups') }));
vi.mock('@/lib/qa/report-followups', () => ({ processQaReportFollowups: m.call('processQaReportFollowups') }));
vi.mock('@/lib/notifications/intent-store', () => ({ dispatchNotificationIntents: m.call('dispatchNotificationIntents') }));
vi.mock('@/lib/marketing/campaign-sender', () => ({ dispatchDueCampaigns: m.call('dispatchDueCampaigns') }));
vi.mock('@/lib/finance/cadence', () => ({ listUsersDueForInvoicing: m.call('listUsersDueForInvoicing') }));
vi.mock('@/lib/finance/auto-invoice', () => ({ generateInvoiceForUser: m.call('generateInvoiceForUser') }));
vi.mock('@/lib/properties/deep-clean-planning', () => ({ planDueDeepCleanDrafts: m.call('planDueDeepCleanDrafts') }));
vi.mock('@/lib/time/auto-clockout', () => ({ autoClockOutStaleTimeLogsForUser: m.call('autoClockOutStaleTimeLogsForUser') }));
vi.mock('@/lib/ops/timing-rule-reconcile', () => ({ runTimingRuleReconcileIfPending: m.call('runTimingRuleReconcileIfPending') }));
vi.mock('@/lib/ai/photo-review', () => ({ processPhotoReviewQueue: m.call('processPhotoReviewQueue') }));
vi.mock('@/lib/ai/property-model-training', () => ({ processPropertyModelTrainingQueue: m.call('processPropertyModelTrainingQueue') }));
vi.mock('@/lib/qa/auto-score', () => ({ runQaAutoScoreSweep: m.call('runQaAutoScoreSweep') }));
vi.mock('@/lib/qa/cleaner-property-stats', () => ({ rebuildCleanerPropertyStats: m.call('rebuildCleanerPropertyStats') }));
vi.mock('@/lib/ops/worker-heartbeat', () => ({ startWorkerHeartbeat: m.call('startWorkerHeartbeat') }));

const defaults = { alertedCases: 0, dispatched: 0, campaigns: 0, warned: 0, escalated: 0, alerted: 0, created: 0, expired: 0, streakProposals: 0, monthlyProposals: 0, sent: 0, flagged: 0 };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); m.handlers.clear();
  vi.stubEnv("SNEEK_WORKERS_ENABLED", "true"); vi.stubEnv("SNEEK_WORKERS_DISABLED", "false"); vi.stubEnv("SNEEK_DISABLED_JOBS", "");
  (globalThis as any).__sneekWorkerFailures = []; (globalThis as any).__sneekJobRuns = [];
  for (const name of ['autoApprovePendingClientJobTasks', 'autoClockOutStaleTimeLogsForUser', 'autoPauseStaleJobs', 'buildLaundryPlanDraft', 'dispatchCleanerDayReminders', 'dispatchClientPostJobAutomationRule', 'dispatchDueCampaigns', 'dispatchJobFollowUp', 'dispatchJobReminders', 'dispatchLaundryDriverNudges', 'dispatchMobileOutbox', 'dispatchNotificationIntents', 'dispatchScheduledEmailCampaigns', 'dispatchScheduledWorkforcePosts', 'dispatchTomorrowPrepSummaries', 'dispatchUnfinishedJobPushReminders', 'generateInvoiceForUser', 'generateJobReport', 'generateRecurringJobs', 'getAppSettings', 'listUsersDueForInvoicing', 'processPhotoReviewQueue', 'processPropertyModelTrainingQueue', 'processQaReportFollowups', 'processSubmissionFollowups', 'rebuildCleanerPropertyStats', 'refreshGoogleReviewsCache', 'runAccountabilityNightly', 'runCredentialExpiryCheck', 'runDocumentExpiryCheck', 'runMissedClockInSweep', 'runQaAutoScoreSweep', 'runRecognitionCheck', 'runSafetyCheckinAlerts', 'runSlaEscalation', 'runTimingRuleReconcileIfPending', 'sendAdminAttentionSummary', 'sendDailyOpsBriefing', 'sendPendingPayApprovalReminders', 'sendStaleCaseFollowUps', 'sendStockAlerts', 'startWorkerHeartbeat', 'sweepStaleEnRouteJobs', 'syncAllIcal']) m.call(name);
  for (const fn of m.calls.values()) fn.mockResolvedValue({ ...defaults });
  m.call("getAppSettings").mockResolvedValue({ recurringJobs: { enabled: false, lookaheadDays: 7 } });
  m.call("buildLaundryPlanDraft").mockResolvedValue([{ jobId: "job" }]);
  m.call("listUsersDueForInvoicing").mockResolvedValue([]);
  m.call("refreshGoogleReviewsCache").mockResolvedValue(null);
  m.timeLogs.mockResolvedValue([{ userId: "cleaner" }, { userId: "other" }]); m.cleanup.mockResolvedValue({ count: 0 });
  m.start.mockResolvedValue(undefined); m.schedule.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function boot() {
  const workerModule = await import("../../workers/boss");
  await vi.waitFor(() => expect(m.call("startWorkerHeartbeat")).toHaveBeenCalledOnce());
  vi.useFakeTimers();
  return workerModule;
}
it("registers Sydney schedules once and only dispatches domain work when its handler runs", async () => {
  await boot();
  expect(m.start).toHaveBeenCalledOnce();
  const names = m.schedule.mock.calls.map(([name]) => name);
  expect(new Set(names).size).toBe(names.length);
  expect(names.length).toBeGreaterThan(30);
  for (const [, , data, options] of m.schedule.mock.calls) { expect(data).toEqual({}); expect(options).toEqual({ tz: "Australia/Sydney" }); }
  expect(m.call("startWorkerHeartbeat")).toHaveBeenCalledWith(true);
  for (const [name, fn] of m.calls) if (name !== "startWorkerHeartbeat") expect(fn, name).not.toHaveBeenCalled();
  for (const handler of m.handlers.values()) await handler();
  expect(m.call("dispatchMobileOutbox")).toHaveBeenCalledOnce();
  expect(m.call("processSubmissionFollowups")).toHaveBeenCalledWith();
  expect(m.call("processQaReportFollowups")).toHaveBeenCalledWith();
  expect(m.call("dispatchNotificationIntents")).toHaveBeenCalledWith(expect.any(Date));
  expect(m.call("autoClockOutStaleTimeLogsForUser").mock.calls).toEqual([["cleaner"], ["other"]]);
  expect(m.timeLogs).toHaveBeenCalledWith({ where: { stoppedAt: null }, distinct: ["userId"], select: { userId: true } });
  expect(m.call("buildLaundryPlanDraft")).toHaveBeenCalledWith(expect.any(Date));
  expect(m.call("planDueDeepCleanDrafts")).toHaveBeenCalledWith({ now: expect.any(Date) });
  expect(m.schedule).toHaveBeenCalledWith("deep-clean-planning", "15 8 * * *", {}, { tz: "Australia/Sydney" });
  expect(m.info).toHaveBeenCalledWith({ count: 1 }, expect.stringContaining("Manual approval"));
  expect(m.call("generateRecurringJobs")).not.toHaveBeenCalled();
  expect(m.call("generateJobReport")).not.toHaveBeenCalled();
});
it("honors selective disable flags and advertises disabled mobile dispatch", async () => {
  vi.stubEnv("SNEEK_DISABLED_JOBS", " mobile-notification-dispatch, weekly-laundry-plan ,email-campaign-dispatch,deep-clean-planning");
  await boot();
  for (const name of ["mobile-notification-dispatch", "weekly-laundry-plan", "email-campaign-dispatch", "deep-clean-planning"]) expect(m.handlers.has(name)).toBe(false);
  expect(m.call("startWorkerHeartbeat")).toHaveBeenCalledWith(false);
  expect(m.handlers.has("submission-followup-dispatch")).toBe(true);
});
it("plans every property page using one cutoff without dispatching jobs or invoices", async () => {
  await boot();
  m.call("planDueDeepCleanDrafts").mockResolvedValueOnce({ scanned: 100, created: 2, existing: 98, invalid: 0, errors: 0, nextCursor: "property-100" })
    .mockResolvedValueOnce({ scanned: 1, created: 1, existing: 0, invalid: 0, errors: 0, nextCursor: null });
  await m.handlers.get("deep-clean-planning")!();
  const now = m.call("planDueDeepCleanDrafts").mock.calls[0][0].now;
  expect(m.call("planDueDeepCleanDrafts").mock.calls).toEqual([[{ now }], [{ now, cursor: "property-100" }]]);
  expect(m.call("generateRecurringJobs")).not.toHaveBeenCalled();
  expect(m.call("generateInvoiceForUser")).not.toHaveBeenCalled();
});
it("records failed and timed-out jobs without rethrowing to pg-boss", async () => {
  const workerModule = await boot();
  m.call("dispatchMobileOutbox").mockRejectedValueOnce(new Error("provider unavailable"));
  await m.handlers.get("mobile-notification-dispatch")!();
  expect(workerModule.getRecentWorkerFailures()[0]).toMatchObject({ jobName: "mobile-notification-dispatch", error: "Error: provider unavailable" });
  m.call("processSubmissionFollowups").mockImplementationOnce(() => new Promise(() => {}));
  const pending = m.handlers.get("submission-followup-dispatch")!();
  await vi.advanceTimersByTimeAsync(600_000); await pending;
  expect(workerModule.getRecentJobRuns().at(-1)).toMatchObject({ name: "submission-followup-dispatch", ok: false, error: "Handler timeout after 600000ms" });
});
it("validates on-demand payloads and forwards correct follow-up intervals", async () => {
  await boot();
  for (const name of ["report-generate", "post-job-followup", "follow-up-1d", "follow-up-3d", "follow-up-14d"]) {
    await m.handlers.get(name)!({ data: {} });
    await m.handlers.get(name)!({ data: { jobId: "j", ruleId: "rule" } });
  }
  expect(m.call("generateJobReport")).toHaveBeenCalledWith("j");
  expect(m.call("dispatchClientPostJobAutomationRule")).toHaveBeenCalledWith({ jobId: "j", ruleId: "rule" });
  expect(m.call("dispatchJobFollowUp").mock.calls).toEqual([["j", "1d"], ["j", "3d"], ["j", "14d"]]);
});
it("can disable every job without registering handlers or schedules", async () => {
  await boot();
  const names = [...m.handlers.keys()];
  vi.useRealTimers(); vi.resetModules(); vi.clearAllMocks(); m.handlers.clear();
  vi.stubEnv("SNEEK_DISABLED_JOBS", names.join(","));
  await boot();
  expect(m.handlers.size).toBe(0); expect(m.schedule).not.toHaveBeenCalled();
  expect(m.call("startWorkerHeartbeat")).toHaveBeenCalledWith(false);
});
it("processes positive domain results and isolates individual invoice generation failures", async () => {
  await boot();
  for (const fn of m.calls.values()) fn.mockResolvedValue(Object.fromEntries(Object.keys(defaults).map(key => [key, 1])));
  m.call("getAppSettings").mockResolvedValue({ recurringJobs: { enabled: true, lookaheadDays: 7 } });
  m.call("listUsersDueForInvoicing").mockResolvedValue([{ userId: "bad", cadence: "SEMIMONTHLY" }, { userId: "good", cadence: "ON_COMPLETION" }, { userId: "empty", cadence: "MONTHLY" }]);
  m.call("generateInvoiceForUser").mockRejectedValueOnce(new Error("draft conflict")).mockResolvedValueOnce({ invoiceId: "draft" }).mockResolvedValueOnce({ invoiceId: null });
  m.call("refreshGoogleReviewsCache").mockResolvedValue({ updatedAt: "now", reviews: [] });
  m.cleanup.mockResolvedValue({ count: 1 });
  for (const name of ["case-follow-up", "admin-attention-summary", "tomorrow-prep-dispatch", "workforce-post-dispatch", "email-campaign-dispatch", "marketing-campaign-dispatch", "sla-escalation", "safety-checkin-alerts", "recurring-job-generate", "document-expiry-check", "daily-invoice-generation", "deep-clean-planning", "recognition-check", "accountability-nightly", "daily-ops-briefing", "google-reviews-refresh", "location-pings-cleanup", "credential-expiry-check"]) await m.handlers.get(name)!();
  const cutoffNow = m.call("listUsersDueForInvoicing").mock.calls[0][0];
  expect(cutoffNow).toBeInstanceOf(Date);
  expect(m.call("generateInvoiceForUser").mock.calls).toEqual([
    ["bad", { cadence: "SEMIMONTHLY", now: cutoffNow }],
    ["good", { cadence: "ON_COMPLETION", now: cutoffNow }],
    ["empty", { cadence: "MONTHLY", now: cutoffNow }],
  ]);
  expect(m.info).toHaveBeenCalledWith({ due: 3, generated: 1 }, "[daily-invoice-generation] complete");
  expect(m.call("generateRecurringJobs")).toHaveBeenCalledWith({ startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  m.call("sendAdminAttentionSummary").mockResolvedValue({ skipped: ["disabled"] });
  m.call("dispatchTomorrowPrepSummaries").mockResolvedValue({ skipped: true });
  m.info.mockClear();
  await m.handlers.get("admin-attention-summary")!(); await m.handlers.get("tomorrow-prep-dispatch")!();
  expect(m.info).not.toHaveBeenCalled();
});
it("keeps runtime and failure history bounded across repeated failures", async () => {
  const workerModule = await boot();
  m.call("dispatchMobileOutbox").mockRejectedValue("unavailable");
  for (let i = 0; i < 205; i++) await m.handlers.get("mobile-notification-dispatch")!();
  expect(workerModule.getRecentWorkerFailures()).toHaveLength(20);
  expect(workerModule.getRecentWorkerFailures()[0].error).toBe("unavailable");
  expect(workerModule.getRecentJobRuns()).toHaveLength(200);
});
it("reports failed startup without advertising a healthy worker", async () => {
  m.start.mockRejectedValueOnce(new Error("connection refused"));
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  await import("../../workers/boss");
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  expect(m.schedule).not.toHaveBeenCalled(); expect(m.call("startWorkerHeartbeat")).not.toHaveBeenCalled();
});
