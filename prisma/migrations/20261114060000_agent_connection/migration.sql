-- Agent connection (2026-11-14): agents created by administrators, hashed
-- bearer tokens and an append-only request audit. Additive only.

-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "areas" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAuditEntry" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "tokenId" TEXT,
    "creatorId" TEXT,
    "method" TEXT NOT NULL,
    "tool" TEXT,
    "argsSummary" JSONB,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "resultBytes" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentProfile_status_createdAt_idx" ON "AgentProfile"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToken_tokenHash_key" ON "AgentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentToken_agentId_createdAt_idx" ON "AgentToken"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAuditEntry_agentId_createdAt_idx" ON "AgentAuditEntry"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAuditEntry_createdAt_idx" ON "AgentAuditEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "AgentToken" ADD CONSTRAINT "AgentToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgentAuditEntry is append-only: refuse UPDATE and DELETE at the database.
CREATE FUNCTION "agent_audit_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AgentAuditEntry rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentAuditEntry_append_only"
BEFORE UPDATE OR DELETE ON "AgentAuditEntry"
FOR EACH ROW EXECUTE FUNCTION "agent_audit_append_only"();
