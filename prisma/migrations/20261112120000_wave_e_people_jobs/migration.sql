-- Wave E (People, Jobs, Calendar, Quality), 2026-11-12.
--
-- Additive and data-preserving: one enum value, four nullable Job columns,
-- four nullable QaFormSubmission columns, two new tables, and backfills that
-- only fill the new columns/tables (plus User."lastSeenAt" where it is null or
-- older than a recorded sign-in). No invoice, pay, payout, rate snapshot,
-- job status or submission score is changed. Re-running any UPDATE/INSERT
-- below changes nothing (each is guarded).
--
-- ENUM: PostgreSQL cannot USE a value added by ALTER TYPE ... ADD VALUE in the
-- same transaction. This migration only ADDS 'CANCELLED'; nothing here writes
-- or compares it, so it is safe under Prisma's runner.

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "cancelledFromStatus" "JobStatus";

-- AlterTable
ALTER TABLE "QaFormSubmission" ADD COLUMN     "templateRevision" INTEGER,
ADD COLUMN     "templateSnapshot" JSONB,
ADD COLUMN     "templateSnapshotName" TEXT,
ADD COLUMN     "templateSnapshotSource" TEXT;

-- CreateTable
CREATE TABLE "UserPayRate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'EDITOR',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "UserPayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLeave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LEAVE',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "StaffLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPayRate_userId_effectiveFrom_idx" ON "UserPayRate"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "StaffLeave_userId_startDate_endDate_idx" ON "StaffLeave"("userId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "StaffLeave_startDate_endDate_idx" ON "StaffLeave"("startDate", "endDate");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPayRate" ADD CONSTRAINT "UserPayRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPayRate" ADD CONSTRAINT "UserPayRate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bounds the API also enforces. Not modelled by Prisma, so never drift.
ALTER TABLE "UserPayRate" ADD CONSTRAINT "UserPayRate_hourlyRate_range_check"
  CHECK ("hourlyRate" >= 0 AND "hourlyRate" <= 1000);
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_dates_order_check"
  CHECK ("endDate" >= "startDate");
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_kind_check"
  CHECK ("kind" IN ('LEAVE', 'DAY_OFF'));
ALTER TABLE "Job" ADD CONSTRAINT "Job_cancel_reason_check"
  CHECK ("cancelledAt" IS NULL OR ("cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0));

-- 1. Pay rate history: every person with a default rate today gets ONE row with
--    that rate, effective from 1970-01-01. The rate resolved for any past job is
--    therefore exactly the rate it resolved to before this migration.
INSERT INTO "UserPayRate" ("id", "userId", "hourlyRate", "effectiveFrom", "source", "createdById", "createdAt")
SELECT 'bf_' || md5(u."id"), u."id", u."hourlyRate", DATE '1970-01-01', 'BACKFILL', NULL, CURRENT_TIMESTAMP
FROM "User" u
WHERE u."hourlyRate" IS NOT NULL
  AND u."hourlyRate" >= 0 AND u."hourlyRate" <= 1000
  AND NOT EXISTS (SELECT 1 FROM "UserPayRate" r WHERE r."userId" = u."id");

-- 2. QA inspections: a copy of the template for every existing inspection.
--    The exact template is not known for older inspections, so each is marked
--    RECONSTRUCTED. Best available: the schema saved as "before" by the first
--    content revision recorded AFTER the inspection (QA_TEMPLATE_REVISION audit
--    rows), else the template as it is now. The revision number is the count of
--    revisions recorded at or before the inspection.
WITH picked AS (
  SELECT s."id",
         COALESCE(rev."schema", t."schema") AS "schema",
         COALESCE(rev."name", t."name") AS "name",
         (
           SELECT COUNT(*)::integer FROM "AuditLog" a
           WHERE a."entity" = 'QaFormTemplate' AND a."action" = 'QA_TEMPLATE_REVISION'
             AND a."entityId" = s."templateId" AND a."createdAt" <= s."createdAt"
         ) AS "revision"
  FROM "QaFormSubmission" s
  JOIN "QaFormTemplate" t ON t."id" = s."templateId"
  LEFT JOIN LATERAL (
    SELECT a."before" -> 'schema' AS "schema", a."before" ->> 'name' AS "name"
    FROM "AuditLog" a
    WHERE a."entity" = 'QaFormTemplate' AND a."action" = 'QA_TEMPLATE_REVISION'
      AND a."entityId" = s."templateId" AND a."createdAt" > s."createdAt"
      AND a."before" ? 'schema'
    ORDER BY a."createdAt" ASC
    LIMIT 1
  ) rev ON TRUE
  WHERE s."templateSnapshotSource" IS NULL
)
UPDATE "QaFormSubmission" s
SET "templateSnapshot" = picked."schema",
    "templateSnapshotName" = picked."name",
    "templateSnapshotSource" = 'RECONSTRUCTED',
    "templateRevision" = picked."revision"
FROM picked
WHERE picked."id" = s."id";

-- 3. Last seen: the latest recorded sign-in, when it is later than the stored
--    value. Sign-in records that exist today: a passkey sign-in stamps
--    WebAuthnCredential."lastUsedAt"; trusting a device at a two-factor
--    sign-in creates a TrustedDevice row ("createdAt"; "lastUsedAt" if ever
--    set). Both are the person who signed in (an admin's "test as" never
--    writes them). Everyone else keeps their value or null ("not recorded").
UPDATE "User" u
SET "lastSeenAt" = d."seenAt"
FROM (
  SELECT "userId", MAX("seenAt") AS "seenAt" FROM (
    SELECT "userId", "lastUsedAt" AS "seenAt" FROM "WebAuthnCredential" WHERE "lastUsedAt" IS NOT NULL
    UNION ALL
    SELECT "userId", GREATEST("createdAt", COALESCE("lastUsedAt", "createdAt")) FROM "TrustedDevice"
  ) x GROUP BY "userId"
) d
WHERE d."userId" = u."id"
  AND d."seenAt" <= CURRENT_TIMESTAMP
  AND (u."lastSeenAt" IS NULL OR u."lastSeenAt" < d."seenAt");
