-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "cleanSkipAt" TIMESTAMP(3),
ADD COLUMN     "cleanSkipDecidedById" TEXT,
ADD COLUMN     "cleanSkipReason" TEXT,
ADD COLUMN     "cleanSkipRequestedById" TEXT,
ADD COLUMN     "cleanSkipStatus" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "jobTimeSource" TEXT NOT NULL DEFAULT 'PROPERTY';
