-- CreateTable
CREATE TABLE "IcalSyncRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "triggeredById" TEXT,
    "revertedById" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "summary" JSONB,
    "snapshot" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "IcalSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IcalSyncRun_integrationId_createdAt_idx" ON "IcalSyncRun"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "IcalSyncRun_propertyId_createdAt_idx" ON "IcalSyncRun"("propertyId", "createdAt");

-- AddForeignKey
ALTER TABLE "IcalSyncRun" ADD CONSTRAINT "IcalSyncRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcalSyncRun" ADD CONSTRAINT "IcalSyncRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcalSyncRun" ADD CONSTRAINT "IcalSyncRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcalSyncRun" ADD CONSTRAINT "IcalSyncRun_revertedById_fkey" FOREIGN KEY ("revertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
