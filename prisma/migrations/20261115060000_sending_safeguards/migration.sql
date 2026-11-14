-- Sending safeguards (2026-11-15): one row per outbound email / SMS / push
-- attempt with the guard's decision (caps, duplicates, quiet hours, pauses,
-- emergency stop), and paused scopes / incidents. Additive only.

-- CreateTable
CREATE TABLE "OutboundMessageEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transport" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "typeKey" TEXT NOT NULL,
    "entityKey" TEXT,
    "contentHash" TEXT NOT NULL,
    "messageClass" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "outcome" TEXT,
    "subject" TEXT,
    "heldPayload" JSONB,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundSafeguardIncident" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pausesSending" BOOLEAN NOT NULL DEFAULT true,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sampleRecipients" JSONB,
    "detail" JSONB,
    "createdById" TEXT,
    "alertedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "OutboundSafeguardIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_transport_recipientKey_createdAt_idx" ON "OutboundMessageEvent"("transport", "recipientKey", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_recipientKey_contentHash_createdAt_idx" ON "OutboundMessageEvent"("recipientKey", "contentHash", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_typeKey_createdAt_idx" ON "OutboundMessageEvent"("typeKey", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_entityKey_createdAt_idx" ON "OutboundMessageEvent"("entityKey", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_decision_createdAt_idx" ON "OutboundMessageEvent"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessageEvent_createdAt_idx" ON "OutboundMessageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "OutboundSafeguardIncident_status_scopeKind_scopeKey_idx" ON "OutboundSafeguardIncident"("status", "scopeKind", "scopeKey");

-- CreateIndex
CREATE INDEX "OutboundSafeguardIncident_createdAt_idx" ON "OutboundSafeguardIncident"("createdAt");

