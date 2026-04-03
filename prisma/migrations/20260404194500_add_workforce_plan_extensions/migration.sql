-- AlterTable
ALTER TABLE "LaundryConfirmation" ADD COLUMN IF NOT EXISTS "s3Key" TEXT;

-- AlterTable
ALTER TABLE "WorkforcePost" ADD COLUMN IF NOT EXISTS "publishAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkforcePostRead" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforcePostRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkforcePostRead_postId_userId_key" ON "WorkforcePostRead"("postId", "userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkforcePostRead" ADD CONSTRAINT "WorkforcePostRead_postId_fkey" FOREIGN KEY ("postId") REFERENCES "WorkforcePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkforcePostRead" ADD CONSTRAINT "WorkforcePostRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "HiringApplication" ADD COLUMN IF NOT EXISTS "interviewNotes" TEXT,
ADD COLUMN IF NOT EXISTS "interviewDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "offerDetails" JSONB,
ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
