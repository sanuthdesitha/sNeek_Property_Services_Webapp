/**
 * pg-boss worker entry point.
 * Run with: tsx workers/boss.ts
 */

import PgBoss from "pg-boss";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { syncAllIcal } from "@/lib/ical/sync";
import { buildLaundryPlanDraft } from "@/lib/laundry/planner";
import { logger } from "@/lib/logger";
import { dispatchJobReminders } from "@/lib/ops/reminders";
import { sendAdminAttentionSummary } from "@/lib/ops/admin-attention-summary";
import { generateRecurringJobs } from "@/lib/ops/recurring";
import { runSlaEscalation } from "@/lib/ops/sla";
import { sendStockAlerts } from "@/lib/ops/stock-alerts";
import { dispatchTomorrowPrepSummaries } from "@/lib/ops/tomorrow-prep";
import { generateJobReport } from "@/lib/reports/generator";
import { getAppSettings } from "@/lib/settings";

const TZ = "Australia/Sydney";
const DATABASE_URL = process.env.DATABASE_URL!;

async function main() {
  const boss = new PgBoss(DATABASE_URL);

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

  await boss.start();
  logger.info("pg-boss started");

  await boss.schedule("ical-sync", "*/40 * * * *", {});
  await boss.work("ical-sync", async () => {
    logger.info("Running iCal sync");
    await syncAllIcal();
  });

  await boss.schedule("reminder-dispatch", "*/5 * * * *", {});
  await boss.work<{ jobId?: string }>("reminder-dispatch", async () => {
    await dispatchJobReminders({ reminderType: "ALL" });
  });

  await boss.schedule("weekly-laundry-plan", "0 9 * * 1", {});
  await boss.work("weekly-laundry-plan", async () => {
    logger.info("Preparing weekly laundry draft");
    const now = toZonedTime(new Date(), TZ);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const draft = await buildLaundryPlanDraft(monday);
    logger.info(
      { count: draft.length },
      "Weekly laundry draft calculated. Manual approval in the admin laundry planner is required before tasks go live."
    );
  });

  await boss.schedule("stock-alerts", "*/15 * * * *", {});
  await boss.work("stock-alerts", async () => {
    await sendStockAlerts();
  });

  await boss.schedule("admin-attention-summary", "*/15 * * * *", {});
  await boss.work("admin-attention-summary", async () => {
    const result = await sendAdminAttentionSummary({ now: new Date() });
    if (result.skipped?.length) return;
    logger.info({ ...result }, "Admin attention summary sent");
  });

  await boss.schedule("tomorrow-prep-dispatch", "*/15 * * * *", {});
  await boss.work("tomorrow-prep-dispatch", async () => {
    const result = await dispatchTomorrowPrepSummaries(new Date());
    if ("skipped" in result) return;
    logger.info({ ...result }, "Tomorrow prep summaries sent");
  });

  await boss.schedule("sla-escalation", "*/15 * * * *", {});
  await boss.work("sla-escalation", async () => {
    const result = await runSlaEscalation(new Date());
    if (result.warned > 0 || result.escalated > 0) {
      logger.warn({ ...result }, "SLA escalation run");
    }
  });

  await boss.schedule("recurring-job-generate", "5 0 * * *", {});
  await boss.work("recurring-job-generate", async () => {
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
  });

  await boss.work<{ jobId: string }>("report-generate", async (job) => {
    if (!job?.data?.jobId) return;
    logger.info({ jobId: job.data.jobId }, "Generating report");
    await generateJobReport(job.data.jobId);
  });

  logger.info("All workers registered. Listening for jobs.");
}

main().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
