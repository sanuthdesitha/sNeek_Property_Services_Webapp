import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ACCOUNTABILITY_SOURCES } from "@/lib/admin/approvals/sources";

/**
 * Read-only review of pay requests approved ABOVE what the cleaner requested
 * and not yet paid (no payroll run and no cleaner invoice stamp). Before the
 * 2026-11-13 rule the approve field could be pre-filled with the client-approved
 * charge, so some of these may carry the client amount as the cleaner's pay.
 *
 * Nothing here writes: the owner reviews the list and corrects a row through
 * the existing Change amount / reverse decisions. Accountability rows
 * (rectifications, bonuses) are not cleaner requests and are left out.
 *
 * The same query, for running by hand in production, is in
 * docs/qa/recent-changes-review-2026-10-09.md ("Cleaner pay is the requested
 * amount").
 */
export type PaidAboveRequestReviewRow = {
  id: string;
  cleanerId: string;
  jobId: string | null;
  title: string | null;
  requestedAmount: number;
  approvedAmount: number;
  reviewedById: string | null;
  reviewedAt: Date | null;
};

export async function listPaidAboveRequest(limit = 500): Promise<PaidAboveRequestReviewRow[]> {
  const take = Math.min(2000, Math.max(1, Math.floor(limit)));
  return db.$queryRaw<PaidAboveRequestReviewRow[]>`
    SELECT "id", "cleanerId", "jobId", "title", "requestedAmount", "approvedAmount", "reviewedById", "reviewedAt"
    FROM "CleanerPayAdjustment"
    WHERE "status" = 'APPROVED'
      AND "includedInPayrollRunId" IS NULL
      AND "includedInCleanerInvoiceId" IS NULL
      AND "approvedAmount" IS NOT NULL
      AND ROUND("approvedAmount"::numeric, 2) > ROUND("requestedAmount"::numeric, 2)
      AND ("source" IS NULL OR "source" NOT IN (${Prisma.join([...ACCOUNTABILITY_SOURCES])}))
    ORDER BY "reviewedAt" DESC NULLS LAST, "id"
    LIMIT ${take}
  `;
}
