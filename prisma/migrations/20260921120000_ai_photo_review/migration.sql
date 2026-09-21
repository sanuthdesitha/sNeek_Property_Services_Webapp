CREATE TABLE "AiPhotoReview" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "settings" JSONB NOT NULL,
  "result" JSONB,
  "sourceFingerprint" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "decision" JSONB,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPhotoReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiPhotoReview_submissionId_key" ON "AiPhotoReview"("submissionId");
CREATE INDEX "AiPhotoReview_status_leaseUntil_createdAt_idx" ON "AiPhotoReview"("status", "leaseUntil", "createdAt");
ALTER TABLE "AiPhotoReview" ADD CONSTRAINT "AiPhotoReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
