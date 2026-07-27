-- Shopping settlement stamps. Additive only — no existing column is altered or dropped.
--
-- Shopping is the fourth stream of money owed to a cleaner (after jobs,
-- pay adjustments and QA inspections) and was the only one with no working
-- double-pay guard. `ShoppingSettlement.includedInPayrollRunId` already existed
-- but lib/inventory/shopping-runs.ts never READ it, there was no cleaner-invoice
-- stamp at all (only the opaque `includedInCleanerInvoiceReference` string, which
-- cannot identify WHICH invoice consumed the row), and approved shopping TIME had
-- no stamp of any kind. So a reimbursement paid by a payroll run was billed again
-- on the next cleaner invoice, and two overlapping invoices could each bill it.
--
-- Expense and time settle INDEPENDENTLY — the primary payroll engine pays
-- reimbursements but has never paid shopping time — so each gets its OWN stamp
-- pair rather than sharing one. The rules live in lib/finance/shopping-settlement.ts
-- (`isShoppingExpenseAvailableForSettlement` / `isShoppingTimeAvailableForSettlement`),
-- mirroring lib/finance/qa-pay.ts.
--
-- Money columns are DOUBLE PRECISION to match every other money column in this
-- schema. `*SettledAmount` freezes what the settling rail actually paid, so a
-- later edit to a run's line costs or approved rate can never retro-alter history.
ALTER TABLE "ShoppingSettlement" ADD COLUMN "includedInPayrollRunAt" TIMESTAMP(3);
ALTER TABLE "ShoppingSettlement" ADD COLUMN "includedInCleanerInvoiceId" TEXT;
ALTER TABLE "ShoppingSettlement" ADD COLUMN "includedInCleanerInvoiceAt" TIMESTAMP(3);
ALTER TABLE "ShoppingSettlement" ADD COLUMN "paySettledAmount" DOUBLE PRECISION;

ALTER TABLE "ShoppingSettlement" ADD COLUMN "timeIncludedInPayrollRunId" TEXT;
ALTER TABLE "ShoppingSettlement" ADD COLUMN "timeIncludedInPayrollRunAt" TIMESTAMP(3);
ALTER TABLE "ShoppingSettlement" ADD COLUMN "timeIncludedInCleanerInvoiceId" TEXT;
ALTER TABLE "ShoppingSettlement" ADD COLUMN "timeIncludedInCleanerInvoiceAt" TIMESTAMP(3);
ALTER TABLE "ShoppingSettlement" ADD COLUMN "timePaySettledAmount" DOUBLE PRECISION;

CREATE INDEX "ShoppingSettlement_includedInCleanerInvoiceId_idx"
    ON "ShoppingSettlement"("includedInCleanerInvoiceId");
CREATE INDEX "ShoppingSettlement_timeIncludedInPayrollRunId_idx"
    ON "ShoppingSettlement"("timeIncludedInPayrollRunId");
CREATE INDEX "ShoppingSettlement_timeIncludedInCleanerInvoiceId_idx"
    ON "ShoppingSettlement"("timeIncludedInCleanerInvoiceId");

-- ── Backfill: everything already settled must READ as settled ──────────────
--
-- NULL means "never settled and payable now". For a brand-new column that is
-- almost always right, but here it is NOT: runs invoiced before this migration
-- were tracked by the reimbursement/time STATUS in ShoppingRun.legacySource, and
-- the new selectors deliberately stop treating those statuses as a paid-guard
-- (a status cannot say WHICH rail paid, which is the whole point of a stamp).
-- Leaving them NULL would therefore re-open every historically-invoiced run for
-- payment. We stamp them with a sentinel id instead: it can never equal a real
-- CleanerInvoiceSubmission id, so `includeInvoiceId` never un-excludes it and the
-- row is permanently spent — the correct, conservative reading of "already paid".
--
-- Preferred sentinel is the existing opaque reference (audit-friendly, e.g.
-- "run:<id>" / "legacy:<id>"), falling back to the settlement's own id.
UPDATE "ShoppingSettlement" s
SET "includedInCleanerInvoiceId" =
        COALESCE(s."includedInCleanerInvoiceReference", 'legacy:' || s."id"),
    "includedInCleanerInvoiceAt" = s."updatedAt"
FROM "ShoppingRun" r
WHERE r."id" = s."shoppingRunId"
  AND s."includedInCleanerInvoiceId" IS NULL
  AND s."includedInPayrollRunId" IS NULL
  AND (
        -- The compat status is authoritative when present…
        r."legacySource" ->> 'cleanerReimbursementStatus' IN ('INVOICED', 'REIMBURSED')
        -- …otherwise a non-null reference is what derived "INVOICED" before.
        OR (
             (r."legacySource" ->> 'cleanerReimbursementStatus') IS NULL
             AND s."includedInCleanerInvoiceReference" IS NOT NULL
           )
      );

-- Same treatment for shopping TIME, keyed on its own status. A run whose expense
-- was invoiced but whose time was only ever APPROVED keeps a NULL time stamp and
-- stays payable — that time is genuinely still owed.
UPDATE "ShoppingSettlement" s
SET "timeIncludedInCleanerInvoiceId" =
        COALESCE(s."includedInCleanerInvoiceReference", 'legacy:' || s."id"),
    "timeIncludedInCleanerInvoiceAt" = s."updatedAt"
FROM "ShoppingRun" r
WHERE r."id" = s."shoppingRunId"
  AND s."timeIncludedInCleanerInvoiceId" IS NULL
  AND r."legacySource" ->> 'shoppingTimeStatus' IN ('INVOICED', 'PAID');
