-- Agent actions (step 6, 2026-11-14): write packs on agents (default none),
-- requests an agent makes that always wait for a person's approval, and their
-- append-only decision history. Additive only.

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "writeAreas" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AgentActionRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + '24:00:00'::interval),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActionEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "agentId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentActionRequest_status_createdAt_idx" ON "AgentActionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentActionRequest_status_expiresAt_idx" ON "AgentActionRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentActionRequest_agentId_idempotencyKey_key" ON "AgentActionRequest"("agentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentActionEvent_requestId_createdAt_idx" ON "AgentActionEvent"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentActionRequest" ADD CONSTRAINT "AgentActionRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionEvent" ADD CONSTRAINT "AgentActionEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AgentActionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AgentActionEvent is append-only: refuse UPDATE and DELETE at the database.
CREATE FUNCTION "agent_action_event_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AgentActionEvent rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentActionEvent_append_only"
BEFORE UPDATE OR DELETE ON "AgentActionEvent"
FOR EACH ROW EXECUTE FUNCTION "agent_action_event_append_only"();

-- AgentActionRequest keeps what was asked: no DELETE, no change to the agent,
-- tool, arguments, preview, key or creation time, and status moves only
-- forward (WAITING -> APPROVED | REJECTED | EXPIRED | FAILED;
-- APPROVED -> EXECUTED | FAILED). A final status never changes again.
CREATE FUNCTION "agent_action_request_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AgentActionRequest rows cannot be deleted';
  END IF;
  IF NEW."agentId" IS DISTINCT FROM OLD."agentId"
    OR NEW."tokenId" IS DISTINCT FROM OLD."tokenId"
    OR NEW."creatorId" IS DISTINCT FROM OLD."creatorId"
    OR NEW."tool" IS DISTINCT FROM OLD."tool"
    OR NEW."area" IS DISTINCT FROM OLD."area"
    OR NEW."arguments"::text IS DISTINCT FROM OLD."arguments"::text
    OR NEW."preview"::text IS DISTINCT FROM OLD."preview"::text
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'What an agent asked for cannot be changed';
  END IF;
  IF OLD."status" IN ('REJECTED', 'EXPIRED', 'EXECUTED', 'FAILED') THEN
    RAISE EXCEPTION 'A decided agent request cannot change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'WAITING' AND NEW."status" IN ('APPROVED', 'REJECTED', 'EXPIRED', 'FAILED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('EXECUTED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'Agent request status cannot move from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentActionRequest_guard"
BEFORE UPDATE OR DELETE ON "AgentActionRequest"
FOR EACH ROW EXECUTE FUNCTION "agent_action_request_guard"();
