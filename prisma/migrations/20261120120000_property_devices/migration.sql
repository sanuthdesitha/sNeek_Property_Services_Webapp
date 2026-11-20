-- Property devices register (2026-11-20): Ring, Minut and hand-entered battery
-- devices, readings history, provider connections, location links and sync runs.
-- Additive only: five new tables, four enums and one nullable Property column.

-- CreateEnum
CREATE TYPE "PropertyDeviceProvider" AS ENUM ('RING', 'MINUT', 'MANUAL');

-- CreateEnum
CREATE TYPE "PropertyDeviceKind" AS ENUM ('CAMERA', 'DOORBELL', 'NOISE_SENSOR', 'SMOKE_ALARM', 'LOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceReadingSource" AS ENUM ('PROVIDER', 'MANUAL', 'CLEANER');

-- CreateEnum
CREATE TYPE "DeviceChargeCondition" AS ENUM ('NONE', 'NEEDS_CHARGE', 'CHARGED_AWAITING_CONFIRMATION');

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "deviceBatteryThresholdPercent" INTEGER;

-- CreateTable
CREATE TABLE "PropertyDevice" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "provider" "PropertyDeviceProvider" NOT NULL DEFAULT 'MANUAL',
    "externalDeviceId" TEXT,
    "externalLocationId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "PropertyDeviceKind" NOT NULL DEFAULT 'OTHER',
    "locationNote" TEXT,
    "batteryPowered" BOOLEAN NOT NULL DEFAULT true,
    "lastBatteryPercent" INTEGER,
    "lastReadingAt" TIMESTAMP(3),
    "lastReadingSource" "DeviceReadingSource",
    "online" BOOLEAN,
    "onlineCheckedAt" TIMESTAMP(3),
    "thresholdPercent" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "chargeCondition" "DeviceChargeCondition" NOT NULL DEFAULT 'NONE',
    "conditionOpenedAt" TIMESTAMP(3),
    "conditionReadingPercent" INTEGER,
    "chargeTaskId" TEXT,
    "chargedAt" TIMESTAMP(3),
    "chargedTaskId" TEXT,
    "lastCouldNotChargeAt" TIMESTAMP(3),
    "lastCouldNotChargeNote" TEXT,
    "conditionClosedAt" TIMESTAMP(3),
    "conditionClosedNote" TEXT,
    "conditionClosedById" TEXT,
    "raiseCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyDeviceReading" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "source" "DeviceReadingSource" NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "jobId" TEXT,
    "jobTaskId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyDeviceReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceProviderConnection" (
    "id" TEXT NOT NULL,
    "provider" "PropertyDeviceProvider" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "accountLabel" TEXT,
    "refreshToken" TEXT,
    "hardwareId" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "connectedAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "failureNoticeAt" TIMESTAMP(3),
    "syncLeaseToken" TEXT,
    "syncLeaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceProviderLocation" (
    "id" TEXT NOT NULL,
    "provider" "PropertyDeviceProvider" NOT NULL,
    "externalLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "propertyId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceProviderLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceSyncRun" (
    "id" TEXT NOT NULL,
    "provider" "PropertyDeviceProvider",
    "mode" TEXT NOT NULL DEFAULT 'AUTO',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "triggeredById" TEXT,
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyDevice_propertyId_isActive_idx" ON "PropertyDevice"("propertyId", "isActive");

-- CreateIndex
CREATE INDEX "PropertyDevice_chargeCondition_isActive_idx" ON "PropertyDevice"("chargeCondition", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyDevice_provider_externalDeviceId_key" ON "PropertyDevice"("provider", "externalDeviceId");

-- CreateIndex
CREATE INDEX "PropertyDeviceReading_deviceId_readAt_idx" ON "PropertyDeviceReading"("deviceId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceProviderConnection_provider_key" ON "DeviceProviderConnection"("provider");

-- CreateIndex
CREATE INDEX "DeviceProviderLocation_propertyId_idx" ON "DeviceProviderLocation"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceProviderLocation_provider_externalLocationId_key" ON "DeviceProviderLocation"("provider", "externalLocationId");

-- CreateIndex
CREATE INDEX "DeviceSyncRun_provider_createdAt_idx" ON "DeviceSyncRun"("provider", "createdAt");

-- AddForeignKey
ALTER TABLE "PropertyDevice" ADD CONSTRAINT "PropertyDevice_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyDeviceReading" ADD CONSTRAINT "PropertyDeviceReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PropertyDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

