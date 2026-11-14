-- In-app tutorials (2026-11-16): per-person tour progress and preference, and
-- administrator tour settings. Additive only; the retired AuthUserState
-- "tutorialSeen" flag is left untouched and still read.

-- CreateEnum
CREATE TYPE "TourProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TourSettingScope" AS ENUM ('ROLE', 'TOUR');

-- CreateTable
CREATE TABLE "TourProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tourKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TourProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "seenSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTourPreference" (
    "userId" TEXT NOT NULL,
    "toursOn" BOOLEAN NOT NULL DEFAULT true,
    "dontShowAgain" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTourPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TourSetting" (
    "id" TEXT NOT NULL,
    "scope" "TourSettingScope" NOT NULL,
    "key" TEXT NOT NULL,
    "toursOn" BOOLEAN,
    "status" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "overrides" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TourProgress_tourKey_status_idx" ON "TourProgress"("tourKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TourProgress_userId_tourKey_key" ON "TourProgress"("userId", "tourKey");

-- CreateIndex
CREATE UNIQUE INDEX "TourSetting_scope_key_key" ON "TourSetting"("scope", "key");

-- AddForeignKey
ALTER TABLE "TourProgress" ADD CONSTRAINT "TourProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTourPreference" ADD CONSTRAINT "UserTourPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
