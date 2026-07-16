/**
 * Retire test/placeholder QaReworkTransfer rows from the cleaner "common
 * mistakes" aggregate WITHOUT deleting the transfer record.
 *
 * Background: getCleanerCommonMistakes (lib/workforce/mistakes.ts) surfaces a
 * QaReworkTransfer.reason as a coaching item. A junk reason typed during
 * testing (e.g. "Test") renders "Test — Slow down here on your final
 * walk-through." in the cleaner's briefing.
 *
 * The aggregate only reads transfers where `affectsCleanerStats: true`
 * (mistakes.ts ~:108), so flipping that flag to false is the least-destructive
 * fix: the transfer row, its minutes/amount and audit trail are preserved, but
 * it no longer feeds the mistakes list. We also blank the reason text so the
 * junk string can't resurface anywhere else.
 *
 * Idempotent — re-running only touches rows still flagged as affecting stats.
 *
 *   DATABASE_URL=<url> npx tsx scripts/cleanup-test-rework-reasons.ts
 */
import { db } from "../lib/db";

/** Reasons we treat as junk (mirrors isJunkMistakeLabel in mistakes.ts). */
const JUNK_REASONS = ["asdf", "xxx", "n/a", "na", "-", ".", "..", "...", "test"];
const REPLACEMENT_REASON = "(removed test entry)";

async function main() {
  // Candidate junk rows that still affect cleaner stats. We over-select in SQL
  // (reason ILIKE 'test%' OR trimmed length <= 2 OR in the junk set) and keep
  // the cast wide; the flag flip below is what actually removes them.
  const candidates = await db.$queryRaw<
    Array<{
      id: string;
      reason: string;
      cleanerUserId: string;
      affectsCleanerStats: boolean;
      status: string;
    }>
  >`
    SELECT id, reason, "cleanerUserId", "affectsCleanerStats", status::text AS status
    FROM "QaReworkTransfer"
    WHERE "affectsCleanerStats" = true
      AND (
        reason ILIKE 'test%'
        OR length(btrim(reason)) <= 2
        OR lower(btrim(reason)) = ANY(${JUNK_REASONS})
      )
    ORDER BY id
  `;

  if (candidates.length === 0) {
    console.log("cleanup-test-rework-reasons: no junk rework reasons found. Nothing to do.");
    return;
  }

  console.log(`Found ${candidates.length} junk QaReworkTransfer row(s):\n`);
  for (const row of candidates) {
    console.log(
      `- ${row.id} | cleaner=${row.cleanerUserId} | status=${row.status} | ` +
        `affectsCleanerStats=${row.affectsCleanerStats} | reason=${JSON.stringify(row.reason)}`
    );
  }

  const ids = candidates.map((c) => c.id);
  // Least-destructive removal: stop the row feeding the mistakes aggregate and
  // blank the junk reason text. The transfer record itself is preserved.
  const result = await db.qaReworkTransfer.updateMany({
    where: { id: { in: ids } },
    data: { affectsCleanerStats: false, reason: REPLACEMENT_REASON },
  });

  console.log(
    `\ncleanup-test-rework-reasons: updated ${result.count} row(s) ` +
      `(affectsCleanerStats=false, reason="${REPLACEMENT_REASON}"). Re-run is safe.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
