-- AI provider layer (2026-11-14): per-request audit, shared rate-limit
-- counters and queued AI tasks. Additive only; no existing data changes.

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "actorUserId" TEXT,
    "agentId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "costMicroUsd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitWindow" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitWindow_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "AiTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "result" JSONB,
    "errorCode" TEXT,
    "error" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");

-- CreateIndex
CREATE INDEX "AiCall_feature_createdAt_idx" ON "AiCall"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiCall_actorUserId_createdAt_idx" ON "AiCall"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitWindow_windowStart_idx" ON "RateLimitWindow"("windowStart");

-- CreateIndex
CREATE INDEX "AiTask_status_leaseUntil_createdAt_idx" ON "AiTask"("status", "leaseUntil", "createdAt");

-- CreateIndex
CREATE INDEX "AiTask_requestedById_createdAt_idx" ON "AiTask"("requestedById", "createdAt");

-- AiCall is an append-only audit: refuse UPDATE and DELETE at the database.
CREATE FUNCTION "ai_call_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AiCall rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiCall_append_only"
BEFORE UPDATE OR DELETE ON "AiCall"
FOR EACH ROW EXECUTE FUNCTION "ai_call_append_only"();
