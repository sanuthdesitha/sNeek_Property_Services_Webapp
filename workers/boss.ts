// SCHEDULE FREQUENCIES — reduced during the May 2026 CPU overload.
// To restore tighter cadence after diagnosing the runaway, edit the cron
// expressions below. See docs/ops/vps-triage.md for the bisect playbook.

/**
 * pg-boss worker entry point.
 * Run with: tsx workers/boss.ts
 *
 * Safety guarantees added in fix(perf):
 *  - Every handler is wrapped in `safeWork()` so a throwing job does NOT
 *    crash the worker process and does NOT spin pg-boss into a fast retry
 *    loop. Errors are logged with the job name.
 *  - Each handler has a hard timeout (default 10 min). A hung job (e.g.
 *    iCal fetch stuck on a TCP read) is aborted so the next tick can run.
 *  - iCal fetch internally has a 15s per-feed timeout (see lib/ical/sync.ts).
 */

import PgBoss from "pg-boss";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { syncAllIcal } from "@/lib/ical/sync";
import { autoApprovePendingClientJobTasks } from "@/lib/job-tasks/service";
import { sendStaleCaseFollowUps } from "@/lib/cases/follow-up";
import { buildLaundryPlanDraft } from "@/lib/laundry/planner";
import { logger } from "@/lib/logger";
import { sendDailyOpsBriefing } from "@/lib/ops/daily-briefing";
import { dispatchJobFollowUp } from "@/lib/ops/follow-up-sequences";
import { dispatchJobReminders } from "@/lib/ops/reminders";
import { sendAdminAttentionSummary } from "@/lib/ops/admin-attention-summary";
import { generateRecurringJobs } from "@/lib/ops/recurring";
import { runSafetyCheckinAlerts } from "@/lib/ops/safety-checkins";
import { runSlaEscalation } from "@/lib/ops/sla";
import { sendStockAlerts } from "@/lib/ops/stock-alerts";
import { dispatchTomorrowPrepSummaries } from "@/lib/ops/tomorrow-prep";
import { dispatchScheduledEmailCampaigns } from "@/lib/marketing/email-campaigns";
import { refreshGoogleReviewsCache } from "@/lib/public-site/google-reviews";
import { generateJobReport } from "@/lib/reports/generator";
import { getAppSettings } from "@/lib/settings";
import { dispatchScheduledWorkforcePosts, runDocumentExpiryCheck, runRecognitionCheck } from "@/lib/workforce/service";
import { dispatchClientPostJobAutomationRule } from "@/lib/notifications/client-automation";

const TZ = "Australia/Sydney";
const DATABASE_URL = process.env.DATABASE_URL!;

const DEFAULT_HANDLER_TIMEOUT_MS = 10 * 60_000;

/**
 * Env-driven kill switches.
 *
 * `SNEEK_WORKERS_DISABLED=true` — bail out of `main()` immediately. Use
 * this on the web container so the web process never accidentally spawns
 * pg-boss listeners.
 *
 * `SNEEK_DISABLED_JOBS=ical-sync,reminder-dispatch,…` — comma-separated
 * job names to skip when registering schedules. Lets ops disable a
 * suspect job without redeploying code. See docs/ops/vps-triage.md.
 */
const DISABLED_JOBS = new Set(
  (process.env.SNEEK_DISABLED_JOBS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function jobEnabled(name: string): boolean {
  if (DISABLED_JOBS.has(name)) {
    logger.warn({ jobName: name }, `[boss] Skipping ${name} — disabled via SNEEK_DISABLED_JOBS`);
    return false;
  }
  return true;
}

/**
 * Recent worker failures — kept in-process so /admin/system/diagnostics can
 * surface them without a separate DB table. Capped at 50 entries.
 */
type WorkerFailure = { jobName: string; at: string; error: string };
const globalRef = globalThis as unknown as { __sneekWorkerFailures?: WorkerFailure[] };
if (!globalRef.__sneekWorkerFailures) globalRef.__sneekWorkerFailures = [];
const failures = globalRef.__sneekWorkerFailures;

export function getRecentWorkerFailures(): WorkerFailure[] {
  return failures.slice(-20).reverse();
}

function recordFailure(jobName: string, err: unknown) {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  failures.push({ jobName, at: new Date().toISOString(), error: message });
  if (failures.length > 50) failures.splice(0, failures.length - 50);
}

/**
 * Per-job runtime history — lets /admin/system/diagnostics surface which
 * job is burning CPU.  Kept in-process (no DB write) so it has zero
 * overhead. Capped at 200 entries; the diagnostics endpoint filters to
 * the last hour and aggregates by job name.
 *
 * NOTE: this lives on `globalThis` so the same process can both run
 * pg-boss and serve the diagnostics route. If workers run in a SEPARATE
 * container from the web app (the recommended topology — see
 * docs/ops/vps-triage.md §10), the diagnostics page on the web container
 * will NOT see worker stats. In that case check the worker container's
 * logs directly.
 */
type JobRun = { name: string; ok: boolean; durationMs: number; error?: string; finishedAt: number };
const RUN_HISTORY_LIMIT = 200;
const globalRunsRef = globalThis as unknown as { __sneekJobRuns?: JobRun[] };
if (!globalRunsRef.__sneekJobRuns) globalRunsRef.__sneekJobRuns = [];
const jobRuns = globalRunsRef.__sneekJobRuns;

function recordJobRun(run: Omit<JobRun, "finishedAt">) {
  jobRuns.push({ ...run, finishedAt: Date.now() });
  if (jobRuns.length > RUN_HISTORY_LIMIT) jobRuns.splice(0, jobRuns.length - RUN_HISTORY_LIMIT);
}

export function getRecentJobRuns(): JobRun[] {
  return jobRuns.slice();
}

/**
 * Wrap a pg-boss handler so:
 *  - it cannot crash the worker process (try/catch)
 *  - it cannot run longer than `timeoutMs` (Promise.race vs a timer)
 *  - failures are logged AND recorded in `recentFailures` for the diagnostics
 *    page so an admin can see what's failing without tail-logging the VPS.
 */
function safeHandler<T>(
  jobName: string,
  handler: (job?: { data: T }) => Promise<unknown>,
  timeoutMs = DEFAULT_HANDLER_TIMEOUT_MS,
) {
  return async (job?: { data: T }) => {
    const start = Date.now();
    try {
      await Promise.race([
        handler(job),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      recordJobRun({ name: jobName, ok: true, durationMs: Date.now() - start });
    } catch (err) {
      logger.error({ err, jobName }, `[worker] ${jobName} failed`);
      recordFailure(jobName, err);
      recordJobRun({
        name: jobName,
        ok: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      // Swallow — returning normally tells pg-boss the job is done.
      // This intentionally prevents pg-boss from spinning into a fast
      // retry loop, which is what was pinning CPU at 97%.
    }
  };
}

async function main() {
  // EMERGENCY (May 2026): Workers are OPT-IN by default. The default
  // behaviour on any new deploy is the worker process exits immediately.
  // Set SNEEK_WORKERS_ENABLED=true on the worker container to actually
  // run pg-boss listeners. This guarantees no scheduled job activity
  // until ops explicitly turns it back on. See docs/ops/vps-triage.md §11.
  if (process.env.SNEEK_WORKERS_ENABLED !== "true") {
    console.warn(
      "[boss] Workers DISABLED by default. Set SNEEK_WORKERS_ENABLED=true on the worker container to enable. " +
      "This is the emergency CPU-overload safe default.",
    );
    process.exit(0);
  }

  // Pre-existing master kill-switch. Lets ops force-disable workers
  // even when SNEEK_WORKERS_ENABLED=true (e.g. on the web container so
  // a single image can serve both roles without the web process ever
  // spawning pg-boss listeners by accident).
  if (process.env.SNEEK_WORKERS_DISABLED === "true") {
    logger.warn("[boss] Workers explicitly disabled via SNEEK_WORKERS_DISABLED — exiting.");
    process.exit(0);
  }

  const boss = new PgBoss(DATABASE_URL);

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

  await boss.start();
  logger.info("pg-boss started");

  if (jobEnabled("ical-sync")) {
    await boss.schedule("ical-sync", "0 */4 * * *", {});
    await boss.work("ical-sync", safeHandler("ical-sync", async () => {
      logger.info("Running iCal sync");
      await syncAllIcal();
    }));
  }

  if (jobEnabled("reminder-dispatch")) {
    await boss.schedule("reminder-dispatch", "*/30 * * * *", {});
    await boss.work<{ jobId?: string }>("reminder-dispatch", safeHandler("reminder-dispatch", async () => {
      await dispatchJobReminders({ reminderType: "ALL" });
    }));
  }

  if (jobEnabled("job-task-auto-approve")) {
    await boss.schedule("job-task-auto-approve", "0 * * * *", {});
    await boss.work("job-task-auto-approve", safeHandler("job-task-auto-approve", async () => {
      await autoApprovePendingClientJobTasks(new Date());
    }));
  }

  if (jobEnabled("case-follow-up")) {
    await boss.schedule("case-follow-up", "0 */4 * * *", {});
    await boss.work("case-follow-up", safeHandler("case-follow-up", async () => {
      const result = await sendStaleCaseFollowUps(new Date());
      if (result.alertedCases > 0) {
        logger.warn({ ...result }, "Stale case follow-up alerts sent");
      }
    }));
  }

  if (jobEnabled("weekly-laundry-plan")) {
    await boss.schedule("weekly-laundry-plan", "0 9 * * 1", {});
    await boss.work("weekly-laundry-plan", safeHandler("weekly-laundry-plan", async () => {
      logger.info("Preparing weekly laundry draft");
      const now = toZonedTime(new Date(), TZ);
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const draft = await buildLaundryPlanDraft(monday);
      logger.info(
        { count: draft.length },
        "Weekly laundry draft calculated. Manual approval in the admin laundry planner is required before tasks go live."
      );
    }));
  }

  if (jobEnabled("stock-alerts")) {
    await boss.schedule("stock-alerts", "0 */2 * * *", {});
    await boss.work("stock-alerts", safeHandler("stock-alerts", async () => {
      await sendStockAlerts();
    }));
  }

  if (jobEnabled("admin-attention-summary")) {
    await boss.schedule("admin-attention-summary", "0 * * * *", {});
    await boss.work("admin-attention-summary", safeHandler("admin-attention-summary", async () => {
      const result = await sendAdminAttentionSummary({ now: new Date() });
      if (result.skipped?.length) return;
      logger.info({ ...result }, "Admin attention summary sent");
    }));
  }

  if (jobEnabled("tomorrow-prep-dispatch")) {
    await boss.schedule("tomorrow-prep-dispatch", "0 */2 * * *", {});
    await boss.work("tomorrow-prep-dispatch", safeHandler("tomorrow-prep-dispatch", async () => {
      const result = await dispatchTomorrowPrepSummaries(new Date());
      if ("skipped" in result) return;
      logger.info({ ...result }, "Tomorrow prep summaries sent");
    }));
  }

  if (jobEnabled("workforce-post-dispatch")) {
    await boss.schedule("workforce-post-dispatch", "0 * * * *", {});
    await boss.work("workforce-post-dispatch", safeHandler("workforce-post-dispatch", async () => {
      const result = await dispatchScheduledWorkforcePosts(new Date());
      if (result.dispatched > 0) {
        logger.info({ ...result }, "Scheduled workforce posts dispatched");
      }
    }));
  }

  if (jobEnabled("email-campaign-dispatch")) {
    await boss.schedule("email-campaign-dispatch", "0 * * * *", {});
    await boss.work("email-campaign-dispatch", safeHandler("email-campaign-dispatch", async () => {
      const result = await dispatchScheduledEmailCampaigns(new Date());
      if (result.campaigns > 0) {
        logger.info({ ...result }, "Scheduled email campaigns dispatched");
      }
    }));
  }

  // Marketing engine v1 — multi-channel campaign dispatcher
  if (jobEnabled("marketing-campaign-dispatch")) {
    await boss.schedule("marketing-campaign-dispatch", "0 * * * *", {});
    await boss.work("marketing-campaign-dispatch", safeHandler("marketing-campaign-dispatch", async () => {
      const { dispatchDueCampaigns } = await import("@/lib/marketing/campaign-sender");
      const result = await dispatchDueCampaigns(new Date());
      if (result.dispatched > 0) {
        logger.info({ ...result }, "Marketing campaigns dispatched");
      }
    }));
  }

  if (jobEnabled("sla-escalation")) {
    await boss.schedule("sla-escalation", "0 * * * *", {});
    await boss.work("sla-escalation", safeHandler("sla-escalation", async () => {
      const result = await runSlaEscalation(new Date());
      if (result.warned > 0 || result.escalated > 0) {
        logger.warn({ ...result }, "SLA escalation run");
      }
    }));
  }

  if (jobEnabled("safety-checkin-alerts")) {
    await boss.schedule("safety-checkin-alerts", "*/30 * * * *", {});
    await boss.work("safety-checkin-alerts", safeHandler("safety-checkin-alerts", async () => {
      const result = await runSafetyCheckinAlerts(new Date());
      if (result.alerted > 0) {
        logger.warn({ ...result }, "Safety check-in alerts sent");
      }
    }));
  }

  if (jobEnabled("recurring-job-generate")) {
    await boss.schedule("recurring-job-generate", "5 3 * * *", {});
    await boss.work("recurring-job-generate", safeHandler("recurring-job-generate", async () => {
      const settings = await getAppSettings();
      if (!settings.recurringJobs.enabled) return;
      const startDate = new Date().toISOString().slice(0, 10);
      const endDate = new Date(Date.now() + settings.recurringJobs.lookaheadDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const result = await generateRecurringJobs({ startDate, endDate });
      if (result.created > 0) {
        logger.info({ ...result, startDate, endDate }, "Recurring jobs generated");
      }
    }));
  }

  if (jobEnabled("document-expiry-check")) {
    await boss.schedule("document-expiry-check", "0 8 * * 1", {});
    await boss.work("document-expiry-check", safeHandler("document-expiry-check", async () => {
      const result = await runDocumentExpiryCheck(new Date());
      if (result.warned > 0 || result.expired > 0) {
        logger.info({ ...result }, "Staff document expiry check completed");
      }
    }));
  }

  // Daily auto-invoice generation
  if (jobEnabled("daily-invoice-generation")) {
    await boss.schedule("daily-invoice-generation", "0 8 * * *", {});
    await boss.work("daily-invoice-generation", safeHandler("daily-invoice-generation", async () => {
      const { listUsersDueForInvoicing } = await import("@/lib/finance/cadence");
      const { generateInvoiceForUser } = await import("@/lib/finance/auto-invoice");
      const due = await listUsersDueForInvoicing();
      if (due.length === 0) return;
      logger.info({ count: due.length }, "[daily-invoice-generation] users due");
      let generated = 0;
      for (const u of due) {
        try {
          const result = await generateInvoiceForUser(u.userId);
          if (result.invoiceId) generated++;
        } catch (err) {
          logger.error({ err, userId: u.userId }, "[daily-invoice-generation] failed");
        }
      }
      logger.info({ due: due.length, generated }, "[daily-invoice-generation] complete");
    }));
  }

  if (jobEnabled("recognition-check")) {
    await boss.schedule("recognition-check", "0 9 * * 0", {});
    await boss.work("recognition-check", safeHandler("recognition-check", async () => {
      const result = await runRecognitionCheck(new Date());
      if (result.created > 0) {
        logger.info({ ...result }, "Automatic staff recognitions awarded");
      }
    }));
  }

  // On-demand jobs (pushed by API handlers / other jobs — no cron schedule).
  // Honour SNEEK_DISABLED_JOBS so ops can stop the worker from processing
  // them entirely if a handler is the offender.
  if (jobEnabled("report-generate")) {
    await boss.work<{ jobId: string }>("report-generate", safeHandler<{ jobId: string }>("report-generate", async (job) => {
      if (!job?.data?.jobId) return;
      logger.info({ jobId: job.data.jobId }, "Generating report");
      await generateJobReport(job.data.jobId);
    }));
  }

  if (jobEnabled("post-job-followup")) {
    await boss.work<{ jobId: string; ruleId: string }>("post-job-followup", safeHandler<{ jobId: string; ruleId: string }>("post-job-followup", async (job) => {
      if (!job?.data?.jobId || !job?.data?.ruleId) return;
      await dispatchClientPostJobAutomationRule({ jobId: job.data.jobId, ruleId: job.data.ruleId });
    }));
  }

  if (jobEnabled("daily-ops-briefing")) {
    await boss.schedule("daily-ops-briefing", "0 7 * * *", {});
    await boss.work("daily-ops-briefing", safeHandler("daily-ops-briefing", async () => {
      const result = await sendDailyOpsBriefing(new Date());
      if ((result.sent ?? 0) > 0) {
        logger.info({ ...result }, "Daily ops briefing sent");
      }
    }));
  }

  if (jobEnabled("follow-up-1d")) {
    await boss.work<{ jobId: string }>("follow-up-1d", safeHandler<{ jobId: string }>("follow-up-1d", async (job) => {
      if (!job?.data?.jobId) return;
      await dispatchJobFollowUp(job.data.jobId, "1d");
    }));
  }
  if (jobEnabled("follow-up-3d")) {
    await boss.work<{ jobId: string }>("follow-up-3d", safeHandler<{ jobId: string }>("follow-up-3d", async (job) => {
      if (!job?.data?.jobId) return;
      await dispatchJobFollowUp(job.data.jobId, "3d");
    }));
  }
  if (jobEnabled("follow-up-14d")) {
    await boss.work<{ jobId: string }>("follow-up-14d", safeHandler<{ jobId: string }>("follow-up-14d", async (job) => {
      if (!job?.data?.jobId) return;
      await dispatchJobFollowUp(job.data.jobId, "14d");
    }));
  }

  if (jobEnabled("google-reviews-refresh")) {
    await boss.schedule("google-reviews-refresh", "0 3 * * 1", {});
    await boss.work("google-reviews-refresh", safeHandler("google-reviews-refresh", async () => {
      const payload = await refreshGoogleReviewsCache();
      if (payload) {
        logger.info({ updatedAt: payload.updatedAt, reviews: payload.reviews.length }, "Google reviews cache refreshed");
      }
    }));
  }

  // Clean up stale location pings (keep 7 days)
  if (jobEnabled("location-pings-cleanup")) {
    await boss.schedule("location-pings-cleanup", "0 3 * * *", {});
    await boss.work("location-pings-cleanup", safeHandler("location-pings-cleanup", async () => {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const result = await db.cleanerLocationPing.deleteMany({
        where: { timestamp: { lt: cutoff } },
      });
      if (result.count > 0) {
        logger.info({ deleted: result.count }, "Old location pings cleaned up");
      }
    }));
  }

  logger.info("All workers registered. Listening for jobs.");
}

main().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
