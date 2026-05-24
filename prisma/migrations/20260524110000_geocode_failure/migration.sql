CREATE TABLE "GeocodeFailure" (
  "id" TEXT NOT NULL,
  "modelType" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "GeocodeFailure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeocodeFailure_modelType_modelId_idx" ON "GeocodeFailure"("modelType", "modelId");
CREATE INDEX "GeocodeFailure_resolvedAt_idx" ON "GeocodeFailure"("resolvedAt");
