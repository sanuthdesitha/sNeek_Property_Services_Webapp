-- A pay decision the CLEANER can read.
--
-- `adminNote` is the reviewing admin's private record of a decision, and it was
-- reaching cleaners by three separate routes: their job screen, the pay-requests
-- list, and the decision push/email. Closing those (2026-08-01) left a rejected
-- or reduced request showing the cleaner no explanation at all — worse than the
-- leak it fixed.
--
-- So the explanation gets its own field, written knowing the cleaner will read
-- it, instead of borrowing a note written for someone else. Nullable: existing
-- decisions have no cleaner-facing message and must not invent one.
ALTER TABLE "CleanerPayAdjustment"
  ADD COLUMN IF NOT EXISTS "decisionMessage" TEXT;
