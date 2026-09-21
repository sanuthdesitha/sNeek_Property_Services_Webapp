CREATE TABLE "AiPropertyModelTraining" (
  "propertyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "desiredRevision" TEXT NOT NULL,
  "trainedRevision" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "lastTrainedAt" TIMESTAMP(3),
  "modelVersion" TEXT,
  "metricsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPropertyModelTraining_pkey" PRIMARY KEY ("propertyId")
);
CREATE INDEX "AiPropertyModelTraining_status_leaseUntil_updatedAt_idx" ON "AiPropertyModelTraining"("status", "leaseUntil", "updatedAt");
ALTER TABLE "AiPropertyModelTraining" ADD CONSTRAINT "AiPropertyModelTraining_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
