ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'OFFERED';

CREATE TYPE "JobAssignmentResponseStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'TRANSFERRED');

ALTER TABLE "JobAssignment"
  ADD COLUMN "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "responseStatus" "JobAssignmentResponseStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "responseNote" TEXT,
  ADD COLUMN "assignedById" TEXT,
  ADD COLUMN "transferredFromUserId" TEXT;

UPDATE "JobAssignment"
SET
  "responseStatus" = 'ACCEPTED',
  "respondedAt" = COALESCE("assignedAt", CURRENT_TIMESTAMP),
  "offeredAt" = COALESCE("assignedAt", CURRENT_TIMESTAMP)
WHERE "responseStatus" = 'PENDING';
