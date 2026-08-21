-- NFC check-in: the tags stuck up at properties, and every tap against them.
--
-- The tag holds a URL ending in `token`, which is why `token` is unique across
-- every property rather than per-property: the URL alone has to identify the
-- tag, because a phone reading it off the lock screen carries no other context.
--
-- `token` is a PUBLIC identifier, not a secret. The business is using commodity
-- NTAG21x tags, which clone in seconds, so nothing here is treated as proof on
-- its own — a scan only becomes a check-in alongside an authenticated cleaner
-- session and a job at that property. See lib/nfc/tags.ts.
--
-- ON DELETE CASCADE from Property: a tag is meaningless once its property is
-- gone, and leaving orphans would let a token keep resolving to nothing.

CREATE TABLE "PropertyNfcTag" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tagUid" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PropertyNfcTag_pkey" PRIMARY KEY ("id")
);

-- Every tap, accepted or REJECTED. The rejected ones are the interesting
-- records: a tag tapped at the wrong property, outside its window, or by
-- somebody with no job there is either a mistake worth explaining to that
-- person or a pattern worth investigating, and neither is visible if only
-- successes are stored.
--
-- `token` is denormalised onto the row on purpose, so a scan of an unregistered
-- or deleted tag still records WHAT was presented. `tagId` is nullable for the
-- same reason.
CREATE TABLE "NfcScanEvent" (
    "id" TEXT NOT NULL,
    "tagId" TEXT,
    "token" TEXT NOT NULL,
    "userId" TEXT,
    "jobId" TEXT,
    "outcome" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NfcScanEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PropertyNfcTag_token_key" ON "PropertyNfcTag"("token");
CREATE UNIQUE INDEX "PropertyNfcTag_tagUid_key" ON "PropertyNfcTag"("tagUid");
CREATE INDEX "PropertyNfcTag_propertyId_idx" ON "PropertyNfcTag"("propertyId");

-- Supports the dedupe lookup ("did this person just tap?") and the per-cleaner
-- audit trail, both of which read newest-first for one user.
CREATE INDEX "NfcScanEvent_userId_createdAt_idx" ON "NfcScanEvent"("userId", "createdAt");
CREATE INDEX "NfcScanEvent_jobId_idx" ON "NfcScanEvent"("jobId");
CREATE INDEX "NfcScanEvent_outcome_createdAt_idx" ON "NfcScanEvent"("outcome", "createdAt");

ALTER TABLE "PropertyNfcTag" ADD CONSTRAINT "PropertyNfcTag_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL throughout on the event table: an audit record must outlive the tag
-- it was taken against, the person who has since left, and the job that was
-- cancelled. Losing that history to a CASCADE would defeat the point of
-- keeping rejected scans at all.
ALTER TABLE "NfcScanEvent" ADD CONSTRAINT "NfcScanEvent_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "PropertyNfcTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NfcScanEvent" ADD CONSTRAINT "NfcScanEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NfcScanEvent" ADD CONSTRAINT "NfcScanEvent_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
