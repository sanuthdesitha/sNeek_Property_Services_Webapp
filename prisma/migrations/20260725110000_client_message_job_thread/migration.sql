-- Per-job client<->admin chat threads (null jobId = the existing global thread)
ALTER TABLE "ClientMessage" ADD COLUMN "jobId" TEXT;
CREATE INDEX "ClientMessage_jobId_createdAt_idx" ON "ClientMessage"("jobId", "createdAt");
