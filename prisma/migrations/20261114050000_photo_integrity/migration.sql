-- Photo integrity (2026-11-14): hashes and camera capture time on stored
-- photos, filled by the media-integrity worker. Existing rows stay null
-- ("Not checked" / "Not recorded") until the worker reads their bytes.

-- AlterTable
ALTER TABLE "SubmissionMedia" ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "capturedAtSource" TEXT,
ADD COLUMN     "contentSha256" TEXT,
ADD COLUMN     "integrityCheckedAt" TIMESTAMP(3),
ADD COLUMN     "integrityError" TEXT,
ADD COLUMN     "perceptualHash" TEXT;

-- CreateIndex
CREATE INDEX "SubmissionMedia_contentSha256_idx" ON "SubmissionMedia"("contentSha256");

-- CreateIndex
CREATE INDEX "SubmissionMedia_perceptualHash_idx" ON "SubmissionMedia"("perceptualHash");

-- CreateIndex
CREATE INDEX "SubmissionMedia_integrityCheckedAt_mediaType_idx" ON "SubmissionMedia"("integrityCheckedAt", "mediaType");
