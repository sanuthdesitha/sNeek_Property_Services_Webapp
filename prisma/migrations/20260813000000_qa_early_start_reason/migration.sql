-- QA may start an inspection before the cleaner files their form, but only
-- with a stated reason. Additive and nullable: every existing assignment stays
-- valid with NULL (meaning "started normally, after submission").
ALTER TABLE "QaAssignment" ADD COLUMN "earlyStartReason" TEXT;
