-- Scheduling rules (2026-11-14): versioned, locked laundry and job auto-scheduling
-- rule values plus point-in-time snapshots. Additive only: no existing table,
-- column, index or row is changed. Version 1 is seeded by the application from
-- the LIVE stored settings the first time the rules are read (not here), so this
-- migration cannot freeze code defaults over values the owner already saved.

-- CreateTable
CREATE TABLE "SchedulingRuleVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "appliesToExisting" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "restoredFromVersion" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "SchedulingRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingRuleSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "liveVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulingRuleSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingRuleVersion_version_key" ON "SchedulingRuleVersion"("version");

-- CreateIndex
CREATE INDEX "SchedulingRuleVersion_effectiveFrom_idx" ON "SchedulingRuleVersion"("effectiveFrom");

-- CreateIndex
CREATE INDEX "SchedulingRuleSnapshot_createdAt_idx" ON "SchedulingRuleSnapshot"("createdAt");
