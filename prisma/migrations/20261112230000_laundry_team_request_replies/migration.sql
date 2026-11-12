-- Laundry team answers to office requests (2026-11-12). Additive: one new
-- table, nothing existing is changed or moved.
--
-- The laundry portal "From the office" inbox lets a laundry partner's team
-- answer an "Ask laundry team" request (the audit row
-- LAUNDRY_TEAM_REQUEST_SENT, referenced by id without a FK). An answer records
-- what the team said (confirmed, cannot, a return day/time, or a message); it
-- never changes the laundry run itself.
CREATE TABLE "LaundryTeamRequestReply" (
    "id" TEXT NOT NULL,
    "laundryTaskId" TEXT NOT NULL,
    "requestAuditId" TEXT NOT NULL,
    "requestKind" VARCHAR(40) NOT NULL,
    "answer" VARCHAR(20) NOT NULL,
    "answerTime" VARCHAR(5),
    "answerDate" DATE,
    "note" TEXT,
    "repliedById" TEXT,
    "repliedByName" TEXT,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaundryTeamRequestReply_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LaundryTeamRequestReply_answer_check" CHECK ("answer" IN ('CONFIRMED', 'CANNOT', 'RETURN_AT', 'MESSAGE')),
    CONSTRAINT "LaundryTeamRequestReply_answerTime_check" CHECK ("answerTime" IS NULL OR "answerTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "LaundryTeamRequestReply_returnAt_check" CHECK ("answer" <> 'RETURN_AT' OR "answerDate" IS NOT NULL)
);

CREATE UNIQUE INDEX "LaundryTeamRequestReply_idempotencyKey_key" ON "LaundryTeamRequestReply"("idempotencyKey");
CREATE INDEX "LaundryTeamRequestReply_laundryTaskId_createdAt_idx" ON "LaundryTeamRequestReply"("laundryTaskId", "createdAt");
CREATE INDEX "LaundryTeamRequestReply_requestAuditId_idx" ON "LaundryTeamRequestReply"("requestAuditId");

ALTER TABLE "LaundryTeamRequestReply" ADD CONSTRAINT "LaundryTeamRequestReply_laundryTaskId_fkey" FOREIGN KEY ("laundryTaskId") REFERENCES "LaundryTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaundryTeamRequestReply" ADD CONSTRAINT "LaundryTeamRequestReply_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
