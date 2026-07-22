-- QA portal Stage 1: assignment ordering, scheduling, arrival check-in, and the
-- original-cleaner rework offer lifecycle.
ALTER TABLE "QaAssignment" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "QaAssignment" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "QaAssignment" ADD COLUMN "checkInAt" TIMESTAMP(3);
ALTER TABLE "QaAssignment" ADD COLUMN "checkInLat" DOUBLE PRECISION;
ALTER TABLE "QaAssignment" ADD COLUMN "checkInLng" DOUBLE PRECISION;
ALTER TABLE "QaAssignment" ADD COLUMN "checkInAccuracyM" DOUBLE PRECISION;
ALTER TABLE "QaAssignment" ADD COLUMN "checkInSkippedReason" TEXT;
ALTER TABLE "QaAssignment" ADD COLUMN "reworkOfferStatus" TEXT;
ALTER TABLE "QaAssignment" ADD COLUMN "reworkOfferedAt" TIMESTAMP(3);
ALTER TABLE "QaAssignment" ADD COLUMN "reworkOfferExpiresAt" TIMESTAMP(3);

CREATE INDEX "QaAssignment_assignedToId_scheduledFor_sequence_idx"
  ON "QaAssignment"("assignedToId", "scheduledFor", "sequence");

-- Audit stamp for the standard-Airbnb checklist fleet rollout.
ALTER TABLE "PropertyChecklistProfile" ADD COLUMN "standardAppliedAt" TIMESTAMP(3);

-- QA portal Stage 2: per-cleaner-per-property duration model powering live
-- "EST finish" and the suggested visit order.
CREATE TABLE "CleanerPropertyStat" (
    "id" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "avgActualHours" DOUBLE PRECISION NOT NULL,
    "p90ActualHours" DOUBLE PRECISION,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "lastJobAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleanerPropertyStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CleanerPropertyStat_cleanerId_propertyId_key"
  ON "CleanerPropertyStat"("cleanerId", "propertyId");
CREATE INDEX "CleanerPropertyStat_propertyId_idx" ON "CleanerPropertyStat"("propertyId");

ALTER TABLE "CleanerPropertyStat" ADD CONSTRAINT "CleanerPropertyStat_cleanerId_fkey"
  FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CleanerPropertyStat" ADD CONSTRAINT "CleanerPropertyStat_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
