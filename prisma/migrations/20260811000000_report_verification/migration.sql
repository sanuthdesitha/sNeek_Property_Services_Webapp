-- Public report verification codes.
-- One code per job; crypto-random (Crockford base32) so codes cannot be
-- enumerated. revokedAt disables a code without deleting the row.

CREATE TABLE "ReportVerification" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ReportVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportVerification_code_key" ON "ReportVerification"("code");

CREATE UNIQUE INDEX "ReportVerification_jobId_key" ON "ReportVerification"("jobId");

ALTER TABLE "ReportVerification"
    ADD CONSTRAINT "ReportVerification_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
