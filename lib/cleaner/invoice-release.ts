import type { Prisma } from "@prisma/client";

/**
 * GIVE A PAYEE BACK THE WORK ON A CANCELLED INVOICE.
 *
 * Sending a cleaner or inspector invoice stamps everything it covers so the next
 * one cannot bill it twice: approved pay adjustments, QA inspection fees and
 * shopping settlements all get `includedInCleanerInvoiceId`. That guard is
 * correct. What was missing is the other half.
 *
 * Voiding or deleting a submission released only the JOBS — `cleanerPaidAt` was
 * cleared and nothing else was. So a cancelled invoice permanently swallowed the
 * payee's approved extra pay, their inspection fees and their out-of-pocket
 * shopping: those rows stayed marked as invoiced, against a submission that no
 * longer existed or would never be paid, and `getCleanerInvoiceData` excludes on
 * exactly that stamp. The payee could never bill them again.
 *
 * That is worse than the client-side version of this bug. A client under-billed
 * is money the business can chase later; a cleaner whose approved $80 fuel claim
 * silently stops appearing on their invoice has no way to discover why, and the
 * business does not find out either — the amount simply gets smaller.
 *
 * NOT THE SHOPPING RUN'S OWN STATUS. `markCleanerShoppingRunsInvoiced` also
 * writes `cleanerReimbursementStatus: "INVOICED"` into the run's compat JSON
 * blob. That is deliberately left alone: it is display state, whereas the
 * settlement stamp released below is the billing guard that actually decides
 * whether the charge reappears. Reversing the blob needs the same compat writer
 * that set it, and editing it from the outside field by field is how a JSON
 * record ends up in a shape its own parser does not expect.
 */
export async function releaseCleanerInvoiceConsumables(
  tx: Prisma.TransactionClient,
  submissionId: string
): Promise<{ adjustments: number; qaInspections: number; shoppingSettlements: number }> {
  const [adjustments, qaInspections, shoppingSettlements] = await Promise.all([
    tx.cleanerPayAdjustment.updateMany({
      where: { includedInCleanerInvoiceId: submissionId },
      // Both columns, so a released adjustment does not read as having been
      // invoiced on a date it no longer belongs to.
      data: { includedInCleanerInvoiceId: null, includedInCleanerInvoiceAt: null },
    }),
    tx.qaAssignment.updateMany({
      where: { includedInCleanerInvoiceId: submissionId },
      data: { includedInCleanerInvoiceId: null },
    }),
    tx.shoppingSettlement.updateMany({
      where: { includedInCleanerInvoiceId: submissionId },
      data: { includedInCleanerInvoiceId: null },
    }),
  ]);

  return {
    adjustments: adjustments.count,
    qaInspections: qaInspections.count,
    shoppingSettlements: shoppingSettlements.count,
  };
}
