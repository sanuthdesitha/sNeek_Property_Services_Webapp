-- Smart property reminders, slice C (2026-11-28): one-off reminders the system
-- proposes from rule facts, waiting for the office. One row per rule and
-- evidence, so a dismissed suggestion is not proposed again.
-- Additive: one new table. No existing table or row changes.

-- CreateTable
CREATE TABLE "ReminderSuggestion" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "cleanerId" TEXT,
    "text" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "moment" "PropertyReminderMoment" NOT NULL,
    "roomKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedRole" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reminderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderSuggestion_status_createdAt_idx" ON "ReminderSuggestion"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSuggestion_rule_evidenceKey_key" ON "ReminderSuggestion"("rule", "evidenceKey");

