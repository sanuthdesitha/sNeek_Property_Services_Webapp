CREATE TABLE "NotificationIntent" (
  "id" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "envelopeHash" TEXT NOT NULL,
  "eventId" TEXT NOT NULL, "eventKey" TEXT NOT NULL, "recipientId" TEXT NOT NULL,
  "transport" TEXT NOT NULL, "envelope" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "notificationId" TEXT, "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationIntent_status_check" CHECK ("status" IN ('QUEUED','PROCESSING','RETRY_WAIT','ACCEPTED','FAILED','UNCERTAIN','SKIPPED')),
  CONSTRAINT "NotificationIntent_transport_check" CHECK ("transport" IN ('INBOX','EMAIL','SMS','WEB_PUSH')),
  CONSTRAINT "NotificationIntent_attemptCount_check" CHECK ("attemptCount" >= 0 AND "attemptCount" <= 5)
);
CREATE UNIQUE INDEX "NotificationIntent_idempotencyKey_key" ON "NotificationIntent"("idempotencyKey");
CREATE UNIQUE INDEX "NotificationIntent_notificationId_key" ON "NotificationIntent"("notificationId");
CREATE INDEX "NotificationIntent_status_nextAttemptAt_idx" ON "NotificationIntent"("status", "nextAttemptAt");
CREATE INDEX "NotificationIntent_recipientId_createdAt_idx" ON "NotificationIntent"("recipientId", "createdAt");
CREATE INDEX "NotificationIntent_eventId_idx" ON "NotificationIntent"("eventId");
CREATE TABLE "NotificationAttempt" (
  "id" TEXT NOT NULL, "intentId" TEXT NOT NULL, "number" INTEGER NOT NULL,
  "leaseToken" TEXT NOT NULL, "status" TEXT NOT NULL, "providerReference" TEXT, "errorCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationAttempt_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "NotificationIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NotificationAttempt_status_check" CHECK ("status" IN ('STARTED','ACCEPTED','NOT_ACCEPTED','UNCERTAIN','SKIPPED')),
  CONSTRAINT "NotificationAttempt_number_check" CHECK ("number" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "NotificationAttempt_intentId_number_key" ON "NotificationAttempt"("intentId", "number");
CREATE INDEX "NotificationAttempt_status_startedAt_idx" ON "NotificationAttempt"("status", "startedAt");
