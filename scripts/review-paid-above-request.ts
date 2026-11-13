/**
 * READ-ONLY review (owner rule 2026-11-13): pay requests approved ABOVE what
 * the cleaner requested and not yet paid (no payroll run, no cleaner invoice).
 * Before the rule, the approve field could pre-fill the client-approved charge,
 * so these rows may carry the client amount as the cleaner's pay. Nothing is
 * written; correct a row in Approvals → Decided ("Paid above request" chip →
 * Change amount) or reverse it.
 *
 *   DATABASE_URL=... npx tsx scripts/review-paid-above-request.ts
 *
 * The same SQL is lib/payroll/paid-above-request.ts and is documented in
 * docs/qa/recent-changes-review-2026-10-09.md.
 */
import { PrismaClient } from "@prisma/client";

type ReviewRow = {
  id: string;
  cleanerEmail: string | null;
  title: string | null;
  requestedAmount: number;
  approvedAmount: number;
  reviewedAt: Date | null;
};

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const rows = await db.$queryRaw<ReviewRow[]>`
      SELECT a."id", u."email" AS "cleanerEmail", a."title", a."requestedAmount", a."approvedAmount", a."reviewedAt"
      FROM "CleanerPayAdjustment" a
      JOIN "User" u ON u."id" = a."cleanerId"
      WHERE a."status" = 'APPROVED'
        AND a."includedInPayrollRunId" IS NULL
        AND a."includedInCleanerInvoiceId" IS NULL
        AND a."approvedAmount" IS NOT NULL
        AND ROUND(a."approvedAmount"::numeric, 2) > ROUND(a."requestedAmount"::numeric, 2)
        AND (a."source" IS NULL OR a."source" NOT IN ('QA_RECTIFICATION_PAY', 'RECTIFICATION_DEDUCTION', 'REWORK_DEDUCTION', 'STREAK_5', 'STREAK_10', 'MONTHLY_RANK_1', 'MONTHLY_RANK_2'))
      ORDER BY a."reviewedAt" DESC NULLS LAST, a."id"
    `;
    console.log(`${rows.length} approved, unpaid pay request(s) above the cleaner's request.`);
    for (const row of rows) {
      console.log(
        [row.id, row.cleanerEmail ?? "unknown cleaner", row.title ?? "Pay request", `requested $${Number(row.requestedAmount).toFixed(2)}`, `approved $${Number(row.approvedAmount).toFixed(2)}`, row.reviewedAt?.toISOString() ?? "not reviewed"].join(" | "),
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
