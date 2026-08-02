-- Money that is INCOME vs money that is a REFUND of the cleaner's own spending.
--
-- Parking fees and shopping receipts were being paid through the same pay
-- adjustment rows as actual work, so a cleaner's invoice added a $12 parking
-- ticket to their services total as if they had earned it. They hadn't — they
-- were being put back where they started. Splitting the two lets the invoice
-- print them under separate headings with separate totals.
--
-- Defaults are chosen so every existing row is unchanged: everything already
-- recorded was work, and it was all taxable.
ALTER TABLE "CleanerPayAdjustment"
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'SERVICE',
  ADD COLUMN IF NOT EXISTS "taxable" BOOLEAN NOT NULL DEFAULT true;

-- "I've been paid", claimed by the cleaner, pending admin confirmation.
--
-- Until now the only way an invoice reached PAID was an admin marking it, so a
-- cleaner who saw the money land had no way to say so and the invoice sat in
-- SUBMITTED. These fields carry the claim (when, an optional note, optional
-- proof) while leaving the paid* block untouched — the business's record of
-- payment stays the business's, written when an admin confirms.
ALTER TABLE "CleanerInvoiceSubmission"
  ADD COLUMN IF NOT EXISTS "paidClaimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidClaimedNote" TEXT,
  ADD COLUMN IF NOT EXISTS "paidClaimedProofKeys" JSONB;
