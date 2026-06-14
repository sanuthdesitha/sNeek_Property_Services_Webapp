-- CreateEnum
CREATE TYPE "MaintenanceSource" AS ENUM ('CLEANER', 'CLIENT', 'QA', 'ADMIN');

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('FURNITURE', 'APPLIANCE', 'ELECTRONICS', 'LINEN', 'BEDDING', 'FIXTURE', 'LIGHTING', 'PLUMBING', 'FLOORING', 'WALLS', 'DECOR', 'KITCHENWARE', 'BATHROOM', 'SAFETY', 'OUTDOOR', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceAction" AS ENUM ('REPLACE', 'REPAIR', 'DEEP_CLEAN', 'MONITOR', 'REMOVE', 'RESTOCK');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ORDERED', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMaintenanceItem" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "jobId" TEXT,
    "reportedByUserId" TEXT NOT NULL,
    "source" "MaintenanceSource" NOT NULL,
    "category" "MaintenanceCategory" NOT NULL DEFAULT 'OTHER',
    "area" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "recommendedAction" "MaintenanceAction" NOT NULL DEFAULT 'REPLACE',
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "photoKeys" JSONB,
    "estimatedCost" DOUBLE PRECISION,
    "clientVisible" BOOLEAN NOT NULL DEFAULT true,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyMaintenanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMaintenanceEvent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT,
    "fromStatus" "MaintenanceStatus",
    "toStatus" "MaintenanceStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyMaintenanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PropertyMaintenanceItem_propertyId_status_idx" ON "PropertyMaintenanceItem"("propertyId", "status");

-- CreateIndex
CREATE INDEX "PropertyMaintenanceItem_status_priority_idx" ON "PropertyMaintenanceItem"("status", "priority");

-- CreateIndex
CREATE INDEX "PropertyMaintenanceItem_reportedByUserId_idx" ON "PropertyMaintenanceItem"("reportedByUserId");

-- CreateIndex
CREATE INDEX "PropertyMaintenanceEvent_itemId_createdAt_idx" ON "PropertyMaintenanceEvent"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMaintenanceItem" ADD CONSTRAINT "PropertyMaintenanceItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMaintenanceItem" ADD CONSTRAINT "PropertyMaintenanceItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMaintenanceItem" ADD CONSTRAINT "PropertyMaintenanceItem_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMaintenanceItem" ADD CONSTRAINT "PropertyMaintenanceItem_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMaintenanceEvent" ADD CONSTRAINT "PropertyMaintenanceEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PropertyMaintenanceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMaintenanceEvent" ADD CONSTRAINT "PropertyMaintenanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
