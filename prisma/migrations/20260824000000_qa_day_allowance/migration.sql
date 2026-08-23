-- One day's travel, paid once.
--
-- A QA inspector visiting four properties on a Tuesday made one journey, not
-- four. The owner's rule is a transport allowance PER DAY, so it attaches to the
-- day rather than to the inspection.
--
-- WHY A TABLE AND NOT A DERIVED FIGURE: deriving the allowance from whichever
-- inspections sit on the invoice being built breaks the moment a day is split
-- across two invoices — the payee excludes one inspection, sends the rest, then
-- bills the last one next fortnight, and Tuesday's travel is paid twice. The day
-- has to be CLAIMED, and the unique constraint is what makes the claim stick.
--
-- `day` is a DATE, not a timestamp. "The Tuesday they travelled" is a calendar
-- fact in Australia/Sydney; storing an instant would split one working day
-- across two either side of midnight UTC and pay it twice for that reason
-- instead.
--
-- `amount` is snapshotted at claim time. The settings rate may change later, and
-- an invoice somebody already holds must not silently re-price.
--
-- The two settlement stamps mirror CleanerPayAdjustment: a row carrying either
-- is spent. Both are cleared when an invoice is voided, so the day becomes
-- claimable again — the same release the shopping and inspection stamps get.
--
-- Additive: a new table only. No existing row is touched.

CREATE TABLE "QaDayAllowance" (
    "id" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "includedInCleanerInvoiceId" TEXT,
    "includedInPayrollRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaDayAllowance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QaDayAllowance_inspectorId_day_key" ON "QaDayAllowance"("inspectorId", "day");
CREATE INDEX "QaDayAllowance_inspectorId_includedInCleanerInvoiceId_idx"
    ON "QaDayAllowance"("inspectorId", "includedInCleanerInvoiceId");

ALTER TABLE "QaDayAllowance" ADD CONSTRAINT "QaDayAllowance_inspectorId_fkey"
    FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
