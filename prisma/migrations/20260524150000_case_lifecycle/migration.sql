CREATE TYPE "CaseState" AS ENUM (
  'OPEN', 'TRIAGE', 'ASSIGNED', 'IN_PROGRESS',
  'AWAITING_CLIENT', 'RESOLVED', 'CLOSED', 'CANCELLED'
);

ALTER TABLE "IssueTicket" ADD COLUMN "state" "CaseState" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "IssueTicket" ADD COLUMN "slaBreachAt" TIMESTAMP(3);

CREATE TABLE "CaseTransition" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "fromState" "CaseState",
  "toState" "CaseState" NOT NULL,
  "actorId" TEXT,
  "reason" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseTransition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseTransition_caseId_occurredAt_idx" ON "CaseTransition"("caseId", "occurredAt");
CREATE INDEX "CaseTransition_toState_idx" ON "CaseTransition"("toState");

ALTER TABLE "CaseTransition"
  ADD CONSTRAINT "CaseTransition_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "IssueTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseTransition"
  ADD CONSTRAINT "CaseTransition_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: derive an initial CaseState from the existing status column
UPDATE "IssueTicket"
SET "state" = CASE
  WHEN "status" IN ('RESOLVED', 'CLOSED') THEN 'RESOLVED'::"CaseState"
  WHEN "status" = 'IN_PROGRESS' THEN 'IN_PROGRESS'::"CaseState"
  ELSE 'OPEN'::"CaseState"
END;
