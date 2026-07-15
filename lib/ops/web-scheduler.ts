import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { syncAllIcalIfDue } from "@/lib/ical/sync";
import { autoApprovePendingClientJobTasks } from "@/lib/job-tasks/service";
import { sendStaleCaseFollowUps } from "@/lib/cases/follow-up";
import { buildLaundryPlanDraft } from "@/lib/laundry/planner";
import { sendAdminAttentionSummary } from "@/lib/ops/admin-attention-summary";
import { dispatchJobReminders } from "@/lib/ops/reminders";
import { dispatchCleanerDayReminders } from "@/lib/ops/cleaner-day-reminders";
import { sendPendingPayApprovalReminders } from "@/lib/ops/pending-pay-approval-reminders";
import { sendStockAlerts } from "@/lib/ops/stock-alerts";
import { dispatchTomorrowPrepSummaries } from "@/lib/ops/tomorrow-prep";
import { generateRecurringJobs } from "@/lib/ops/recurring";
import { runSafetyCheckinAlerts } from "@/lib/ops/safety-checkins";
import { runSlaEscalation } from "@/lib/ops/sla";
import { sendDailyOpsBriefing } from "@/lib/ops/daily-briefing";
import { dispatchScheduledEmailCampaigns } from "@/lib/marketing/email-campaigns";
import { refreshGoogleReviewsCache } from "@/lib/public-site/google-reviews";
import { dispatchScheduledWorkforcePosts, runDocumentExpiryCheck, runRecognitionCheck } from "@/lib/workforce/service";
import { sweepStaleEnRouteJobs } from "@/lib/ops/stale-en-route";
import { runAccountabilityNightly } from "@/lib/accountability/streaks";

const TZ = "Australia/Sydney";
const WEB_SCHEDULER_MIN_INTERVAL_MS = 5 * 60_000;

// Default ON. The dedicated pg-boss worker is preferred, but a single-container
// deployment (web only, no worker) would otherwise run NO automation at all.
// This fallback runs the same jobs in the web process and AUTOMATICALLY stands
// down when a dedicated worker is detected (see isDedicatedWorkerActive), so the
// two never double-fire. Set SNEEK_WEB_SCHEDULER_ENABLED=false to hard-disable.
const WEB_SCHEDULER_ENABLED = process.env.SNEEK_WEB_SCHEDULER_ENABLED !== "false";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type FallbackJob = {
  name: string;
  minIntervalMs: number;
  /** Sydney hour (0-23) the job is pinned to (daily/weekly jobs). */
  hour?: number;
  /** Sydney day of week (0=Sun) the job is pinned to (weekly jobs). */
  dow?: number;
  run: () => Promise<void>;
};

const JOBS: FallbackJob[] = [
  // Called frequently; syncAllIcalIfDue gates each feed by its own due time.
  { name: "ical-sync", minIntervalMs: 20 * MIN, run: async () => { await syncAllIcalIfDue(new Date()); } },
  { name: "reminder-dispatch", minIntervalMs: 30 * MIN, run: async () => { await dispatchJobReminders({ reminderType: "ALL" }); } },
  // Day-of high-alert reminder to the assigned cleaner (web+email+sms per their
  // prefs). Runs every 30 min; the dispatcher gates on 6AM / within-2h and
  // de-dupes, so it fires once per cleaner+job per day.
  { name: "cleaner-day-reminder", minIntervalMs: 30 * MIN, run: async () => { await dispatchCleanerDayReminders(new Date()); } },
  { name: "job-task-auto-approve", minIntervalMs: HOUR, run: async () => { await autoApprovePendingClientJobTasks(new Date()); } },
  { name: "case-follow-up", minIntervalMs: 4 * HOUR, run: async () => { await sendStaleCaseFollowUps(new Date()); } },
  { name: "stock-alerts", minIntervalMs: 2 * HOUR, run: async () => { await sendStockAlerts(); } },
  { name: "admin-attention-summary", minIntervalMs: HOUR, run: async () => { await sendAdminAttentionSummary({ now: new Date() }); } },
  { name: "tomorrow-prep-dispatch", minIntervalMs: 2 * HOUR, run: async () => { await dispatchTomorrowPrepSummaries(new Date()); } },
  { name: "workforce-post-dispatch", minIntervalMs: HOUR, run: async () => { await dispatchScheduledWorkforcePosts(new Date()); } },
  { name: "email-campaign-dispatch", minIntervalMs: HOUR, run: async () => { await dispatchScheduledEmailCampaigns(new Date()); } },
  { name: "marketing-campaign-dispatch", minIntervalMs: HOUR, run: async () => {
    const { dispatchDueCampaigns } = await import("@/lib/marketing/campaign-sender");
    await dispatchDueCampaigns(new Date());
  } },
  { name: "sla-escalation", minIntervalMs: HOUR, run: async () => { await runSlaEscalation(new Date()); } },
  { name: "safety-checkin-alerts", minIntervalMs: 30 * MIN, run: async () => { await runSafetyCheckinAlerts(new Date()); } },
  // Revert jobs abandoned in EN_ROUTE (no arrival within 6h) back to ASSIGNED so
  // they don't sit "on the way" forever.
  { name: "stale-en-route-sweep", minIntervalMs: 30 * MIN, run: async () => { await sweepStaleEnRouteJobs(new Date()); } },
  // Time-pinned daily jobs (Sydney). minInterval > 1h so they only fire once
  // per window across multiple 5-min ticks.
  { name: "daily-ops-briefing", minIntervalMs: 20 * HOUR, hour: 7, run: async () => { await sendDailyOpsBriefing(new Date()); } },
  { name: "pending-pay-approval-reminder", minIntervalMs: 20 * HOUR, hour: 9, run: async () => { await sendPendingPayApprovalReminders({ now: new Date() }); } },
  { name: "daily-invoice-generation", minIntervalMs: 20 * HOUR, hour: 8, run: async () => {
    const { listUsersDueForInvoicing } = await import("@/lib/finance/cadence");
    const { generateInvoiceForUser } = await import("@/lib/finance/auto-invoice");
    const due = await listUsersDueForInvoicing();
    for (const u of due) {
      try { await generateInvoiceForUser(u.userId); }
      catch (err) { logger.error({ err, userId: u.userId }, "[web-scheduler] daily-invoice failed"); }
    }
  } },
  { name: "recurring-job-generate", minIntervalMs: 20 * HOUR, hour: 3, run: async () => {
    const settings = await getAppSettings();
    if (!settings.recurringJobs.enabled) return;
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + settings.recurringJobs.lookaheadDays * DAY).toISOString().slice(0, 10);
    await generateRecurringJobs({ startDate, endDate });
  } },
  { name: "location-pings-cleanup", minIntervalMs: 20 * HOUR, hour: 3, run: async () => {
    const cutoff = new Date(Date.now() - 7 * DAY);
    await db.cleanerLocationPing.deleteMany({ where: { timestamp: { lt: cutoff } } });
  } },
  // Time-pinned weekly jobs (Sydney).
  { name: "weekly-laundry-plan", minIntervalMs: 6 * DAY, hour: 9, dow: 1, run: async () => {
    const now = toZonedTime(new Date(), TZ);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    await buildLaundryPlanDraft(monday);
  } },
  { name: "document-expiry-check", minIntervalMs: 6 * DAY, hour: 8, dow: 1, run: async () => { await runDocumentExpiryCheck(new Date()); } },
  { name: "recognition-check", minIntervalMs: 6 * DAY, hour: 9, dow: 0, run: async () => { await runRecognitionCheck(new Date()); } },
  // Accountability nightly — quality-streak + monthly-ranking bonus proposals.
  // Pinned to 20:00 Sydney (matches boss.ts 20:30 window); creates PENDING
  // pay-adjustment proposals only (manager approves before payroll).
  { name: "accountability-nightly", minIntervalMs: 20 * HOUR, hour: 20, run: async () => { await runAccountabilityNightly({ now: new Date() }); } },
  // Cache TTL is 24h (getCachedGoogleReviews), so refresh DAILY — a weekly
  // refresh left the cache stale (returning null → empty reviews widget) 6 of 7
  // days. Pinned to 03:00 Sydney.
  { name: "google-reviews-refresh", minIntervalMs: 20 * HOUR, hour: 3, run: async () => { await refreshGoogleReviewsCache(); } },
];

type SchedulerState = {
  running: boolean;
  lastStartedAt: number;
  lastRunByJob: Record<string, number>;
};

type JobRun = { name: string; ok: boolean; durationMs: number; error?: string; finishedAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __sneekWebSchedulerState: SchedulerState | undefined;
  // eslint-disable-next-line no-var
  var __sneekWebSchedulerLastTick: number | undefined;
  // eslint-disable-next-line no-var
  var __sneekJobRuns: JobRun[] | undefined;
}

function getState(): SchedulerState {
  if (!global.__sneekWebSchedulerState) {
    global.__sneekWebSchedulerState = { running: false, lastStartedAt: 0, lastRunByJob: {} };
  }
  return global.__sneekWebSchedulerState;
}

function recordRun(run: Omit<JobRun, "finishedAt">) {
  if (!global.__sneekJobRuns) global.__sneekJobRuns = [];
  global.__sneekJobRuns.push({ ...run, finishedAt: Date.now() });
  if (global.__sneekJobRuns.length > 200) {
    global.__sneekJobRuns.splice(0, global.__sneekJobRuns.length - 200);
  }
}

/**
 * Detect whether a dedicated pg-boss worker is running, so this in-web fallback
 * can stand down and avoid double-firing jobs. Signals (shared Postgres state):
 *  - pgboss.schedule has rows → a worker registered its crons, OR
 *  - a pg-boss job was created in the last 90 min → a worker is actively ticking.
 * If the pgboss schema is absent (query throws), no worker exists → run fallback.
 */
async function isDedicatedWorkerActive(): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<{ schedules: number; recent: number }[]>(
      `SELECT
         (SELECT count(*)::int FROM pgboss.schedule) AS schedules,
         (SELECT count(*)::int FROM pgboss.job WHERE createdon > now() - interval '90 minutes') AS recent`,
    );
    const row = rows?.[0];
    if (!row) return false;
    return (row.schedules ?? 0) > 0 || (row.recent ?? 0) > 0;
  } catch {
    return false;
  }
}

function isJobDue(job: FallbackJob, state: SchedulerState, zoned: Date): boolean {
  const last = state.lastRunByJob[job.name] ?? 0;
  if (Date.now() - last < job.minIntervalMs) return false;
  if (job.hour !== undefined && zoned.getHours() !== job.hour) return false;
  if (job.dow !== undefined && zoned.getDay() !== job.dow) return false;
  return true;
}

async function runScheduledTick() {
  if (await isDedicatedWorkerActive()) {
    // A dedicated worker owns the schedule — do nothing.
    return;
  }

  const state = getState();
  const zoned = toZonedTime(new Date(), TZ);

  for (const job of JOBS) {
    if (!isJobDue(job, state, zoned)) continue;
    state.lastRunByJob[job.name] = Date.now();
    const start = Date.now();
    try {
      await job.run();
      recordRun({ name: job.name, ok: true, durationMs: Date.now() - start });
    } catch (err) {
      logger.error({ err, jobName: job.name }, "[web-scheduler] job failed");
      recordRun({ name: job.name, ok: false, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/**
 * Opportunistically advance the scheduler. Called from the root layout on each
 * server render; throttled so it fires at most once every 5 minutes. Fire and
 * forget — never blocks the request.
 */
export function kickWebScheduledOps() {
  if (!WEB_SCHEDULER_ENABLED) return;
  if (process.env.SNEEK_DISABLE_WEB_SCHEDULED_FALLBACK === "1") return;

  const state = getState();
  const now = Date.now();
  if (state.running) return;
  if (now - state.lastStartedAt < WEB_SCHEDULER_MIN_INTERVAL_MS) return;

  state.running = true;
  state.lastStartedAt = now;
  global.__sneekWebSchedulerLastTick = now;

  setTimeout(() => {
    void runScheduledTick()
      .catch((err) => {
        logger.error({ err }, "Web scheduled fallback tick failed");
      })
      .finally(() => {
        state.running = false;
      });
  }, 0);
}
