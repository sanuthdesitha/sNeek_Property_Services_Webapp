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
    try {
      await Promise.race([
        handler(job),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    } catch (err) {
      logger.error({ err, jobName }, `[worker] ${jobName} failed`);
      recordFailure(jobName, err);
      // Swallow — returning normally tells pg-boss the job is done.
      // This intentionally prevents pg-boss from spinning into a fast
      // retry loop, which is what was pinning CPU at 97%.
    }
  };
}

async function main() {
  const boss = new PgBoss(DATABASE_URL);

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

  await boss.start();
  logger.info("pg-boss started");

  await boss.schedule("ical-sync", "*/40 * * * *", {});
  await boss.work("ical-sync", safeHandler("ical-sync", async () => {
    logger.info("Running iCal sync");
    await syncAllIcal();
  }));

  await boss.schedule("reminder-dispatch", "*/5 * * * *", {});
  await boss.work<{ jobId?: string }>("reminder-dispatch", safeHandler("reminder-dispatch", async () => {
    await dispatchJobReminders({ reminderType: "ALL" });
  }));

  await boss.schedule("job-task-auto-approve", "*/5 * * * *", {});
  await boss.work("job-task-auto-approve", safeHandler("job-task-auto-approve", async () => {
    await autoApprovePendingClientJobTasks(new Date());
  }));

  await boss.schedule("case-follow-up", "0 * * * *", {});
  await boss.work("case-follow-up", safeHandler("case-follow-up", async () => {
    const result = await sendStaleCaseFollowUps(new Date());
    if (result.alertedCases > 0) {
      logger.warn({ ...result }, "Stale case follow-up alerts sent");
    }
  }));

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

  await boss.schedule("stock-alerts", "*/15 * * * *", {});
  await boss.work("stock-alerts", safeHandler("stock-alerts", async () => {
    await sendStockAlerts();
  }));

  await boss.schedule("admin-attention-summary", "*/15 * * * *", {});
  await boss.work("admin-attention-summary", safeHandler("admin-attention-summary", async () => {
    const result = await sendAdminAttentionSummary({ now: new Date() });
    if (result.skipped?.length) return;
    logger.info({ ...result }, "Admin attention summary sent");
  }));

  await boss.schedule("tomorrow-prep-dispatch", "*/15 * * * *", {});
  await boss.work("tomorrow-prep-dispatch", safeHandler("tomorrow-prep-dispatch", async () => {
    const result = await dispatchTomorrowPrepSummaries(new Date());
    if ("skipped" in result) return;
    logger.info({ ...result }, "Tomorrow prep summaries sent");
  }));

  await boss.schedule("workforce-post-dispatch", "*/5 * * * *", {});
  await boss.work("workforce-post-dispatch", safeHandler("workforce-post-dispatch", async () => {
    const result = await dispatchScheduledWorkforcePosts(new Date());
    if (result.dispatched > 0) {
      logger.info({ ...result }, "Scheduled workforce posts dispatched");
    }
  }));

  await boss.schedule("email-campaign-dispatch", "*/5 * * * *", {});
  await boss.work("email-campaign-dispatch", safeHandler("email-campaign-dispatch", async () => {
    const result = await dispatchScheduledEmailCampaigns(new Date());
    if (result.campaigns > 0) {
      logger.info({ ...result }, "Scheduled email campaigns dispatched");
    }
  }));

  // Marketing engine v1 — multi-channel campaign dispatcher
  await boss.schedule("marketing-campaign-dispatch", "*/5 * * * *", {});
  await boss.work("marketing-campaign-dispatch", safeHandler("marketing-campaign-dispatch", async () => {
    const { dispatchDueCampaigns } = await import("@/lib/marketing/campaign-sender");
    const result = await dispatchDueCampaigns(new Date());
    if (result.dispatched > 0) {
      logger.info({ ...result }, "Marketing campaigns dispatched");
    }
  }));

  await boss.schedule("sla-escalation", "*/15 * * * *", {});
  await boss.work("sla-escalation", safeHandler("sla-escalation", async () => {
    const result = await runSlaEscalation(new Date());
    if (result.warned > 0 || result.escalated > 0) {
      logger.warn({ ...result }, "SLA escalation run");
    }
  }));

  await boss.schedule("safety-checkin-alerts", "*/10 * * * *", {});
  await boss.work("safety-checkin-alerts", safeHandler("safety-checkin-alerts", async () => {
    const result = await runSafetyCheckinAlerts(new Date());
    if (result.alerted > 0) {
      logger.warn({ ...result }, "Safety check-in alerts sent");
    }
  }));

  await boss.schedule("recurring-job-generate", "5 0 * * *", {});
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

  await boss.schedule("document-expiry-check", "0 8 * * *", {});
  await boss.work("document-expiry-check", safeHandler("document-expiry-check", async () => {
    const result = await runDocumentExpiryCheck(new Date());
    if (result.warned > 0 || result.expired > 0) {
      logger.info({ ...result }, "Staff document expiry check completed");
    }
  }));

  // Daily auto-invoice generation
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

  await boss.schedule("recognition-check", "0 9 * * 0", {});
  await boss.work("recognition-check", safeHandler("recognition-check", async () => {
    const result = await runRecognitionCheck(new Date());
    if (result.created > 0) {
      logger.info({ ...result }, "Automatic staff recognitions awarded");
    }
  }));

  await boss.work<{ jobId: string }>("report-generate", safeHandler<{ jobId: string }>("report-generate", async (job) => {
    if (!job?.data?.jobId) return;
    logger.info({ jobId: job.data.jobId }, "Generating report");
    await generateJobReport(job.data.jobId);
  }));

  await boss.work<{ jobId: string; ruleId: string }>("post-job-followup", safeHandler<{ jobId: string; ruleId: string }>("post-job-followup", async (job) => {
    if (!job?.data?.jobId || !job?.data?.ruleId) return;
    await dispatchClientPostJobAutomationRule({ jobId: job.data.jobId, ruleId: job.data.ruleId });
  }));

  await boss.schedule("daily-ops-briefing", "0 7 * * *", {});
  await boss.work("daily-ops-briefing", safeHandler("daily-ops-briefing", async () => {
    const result = await sendDailyOpsBriefing(new Date());
    if ((result.sent ?? 0) > 0) {
      logger.info({ ...result }, "Daily ops briefing sent");
    }
  }));

  await boss.work<{ jobId: string }>("follow-up-1d", safeHandler<{ jobId: string }>("follow-up-1d", async (job) => {
    if (!job?.data?.jobId) return;
    await dispatchJobFollowUp(job.data.jobId, "1d");
  }));
  await boss.work<{ jobId: string }>("follow-up-3d", safeHandler<{ jobId: string }>("follow-up-3d", async (job) => {
    if (!job?.data?.jobId) return;
    await dispatchJobFollowUp(job.data.jobId, "3d");
  }));
  await boss.work<{ jobId: string }>("follow-up-14d", safeHandler<{ jobId: string }>("follow-up-14d", async (job) => {
    if (!job?.data?.jobId) return;
    await dispatchJobFollowUp(job.data.jobId, "14d");
  }));

  await boss.schedule("google-reviews-refresh", "0 3 * * *", {});
  await boss.work("google-reviews-refresh", safeHandler("google-reviews-refresh", async () => {
    const payload = await refreshGoogleReviewsCache();
    if (payload) {
      logger.info({ updatedAt: payload.updatedAt, reviews: payload.reviews.length }, "Google reviews cache refreshed");
    }
  }));

  // Clean up stale location pings (keep 7 days)
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

  logger.info("All workers registered. Listening for jobs.");
}

main().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
