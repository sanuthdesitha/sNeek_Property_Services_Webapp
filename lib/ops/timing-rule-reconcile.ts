import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { applyJobTimingRules, parseJobInternalNotes, resolveRuleTime } from "@/lib/jobs/meta";

const TZ = "Australia/Sydney";

/**
 * AppSetting flag gating the one-shot reconcile. Semantics:
 *   - row absent            → pending (default true the first time)
 *   - row value === false   → already ran, never run again
 * The web-scheduler entry checks this every tick (~30 min interval) and the
 * run clears it on success, so the sweep executes exactly once per deploy of
 * this fix.
 */
export const TIMING_RULE_RECONCILE_FLAG_KEY = "timingRuleReconcilePending";

/** Cap on rows updated in the single sweep (safety valve). */
const MAX_UPDATES = 500;

async function isReconcilePending(): Promise<boolean> {
  const row = await db.appSetting.findUnique({
    where: { key: TIMING_RULE_RECONCILE_FLAG_KEY },
    select: { value: true },
  });
  if (!row) return true; // default true the first time
  return row.value !== false;
}

async function clearReconcileFlag() {
  await db.appSetting.upsert({
    where: { key: TIMING_RULE_RECONCILE_FLAG_KEY },
    create: { key: TIMING_RULE_RECONCILE_FLAG_KEY, value: false },
    update: { value: false },
  });
}

/**
 * One-shot repair for jobs whose startTime/dueTime drifted from their admin
 * timing rules (early check-in / late checkout in internalNotes meta) because
 * historical iCal re-syncs overwrote the columns without re-applying the rules.
 *
 * For future jobs (scheduledDate >= today Sydney) with an enabled timing rule,
 * recomputes the times via applyJobTimingRules and updates only rows that
 * differ (capped at MAX_UPDATES), writes one summary AuditLog row
 * (action TIMING_RULE_RECONCILE), then clears the pending flag so it never
 * runs again.
 */
export async function runTimingRuleReconcileIfPending(now = new Date()) {
  if (!(await isReconcilePending())) return;

  // Jobs store scheduledDate as a UTC date-only value; compare against today's
  // Sydney calendar date.
  const sydneyTodayKey = format(toZonedTime(now, TZ), "yyyy-MM-dd");
  const today = new Date(`${sydneyTodayKey}T00:00:00.000Z`);

  // Serialized timing rules always carry `"enabled":true` when active — use it
  // to narrow the scan; the parse below is still the source of truth.
  const candidates = await db.job.findMany({
    where: {
      scheduledDate: { gte: today },
      internalNotes: { contains: '"enabled":true' },
    },
    select: { id: true, startTime: true, dueTime: true, internalNotes: true },
  });

  let scanned = 0;
  let ruled = 0;
  let updated = 0;
  let capped = false;

  for (const job of candidates) {
    scanned += 1;
    const meta = parseJobInternalNotes(job.internalNotes);
    const hasRule = Boolean(resolveRuleTime(meta.earlyCheckin) || resolveRuleTime(meta.lateCheckout));
    if (!hasRule) continue;
    ruled += 1;

    const applied = applyJobTimingRules({
      startTime: job.startTime,
      dueTime: job.dueTime,
      earlyCheckin: meta.earlyCheckin,
      lateCheckout: meta.lateCheckout,
    });
    const nextStart = applied.startTime ?? job.startTime ?? null;
    const nextDue = applied.dueTime ?? job.dueTime ?? null;
    if (nextStart === (job.startTime ?? null) && nextDue === (job.dueTime ?? null)) continue;

    if (updated >= MAX_UPDATES) {
      capped = true;
      break;
    }
    await db.job.update({
      where: { id: job.id },
      data: { startTime: nextStart, dueTime: nextDue },
    });
    updated += 1;
  }

  // One summary audit row. AuditLog.userId is required — attribute the system
  // sweep to the oldest active admin/ops account (same fallback pattern as
  // other schedulers); skip the audit if none exists.
  try {
    const actor = await db.user.findFirst({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (actor) {
      await db.auditLog.create({
        data: {
          userId: actor.id,
          action: "TIMING_RULE_RECONCILE",
          entity: "Job",
          entityId: "timing-rule-reconcile",
          after: { scanned, ruled, updated, capped, fromDate: sydneyTodayKey } as any,
        },
      });
    }
  } catch (err) {
    logger.error({ err }, "[timing-rule-reconcile] failed to write audit row");
  }

  await clearReconcileFlag();
  logger.info({ scanned, ruled, updated, capped }, "[timing-rule-reconcile] completed one-shot sweep");
}
