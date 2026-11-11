-- Lost and found: guest details from the job's booking, and where the item is kept.
-- Urgent stock: needs and their history move from AppSetting JSON to tables.
--
-- Forward only and data-preserving:
--  * LostFoundItem gains four nullable columns. Only items with NO guest text
--    whose job has a booking with a guest name or phone are filled in (from
--    that booking, guestSource BOOKING). Items that already carry guest text
--    get guestSource MANUAL (only the office can have typed it) and nothing
--    else changes. Every other row is left as it was.
--  * Every urgent stock need and event that can be read is COPIED into the new
--    tables with its id. The AppSetting rows are NOT deleted in this release;
--    a row that cannot be read stays where it is and is counted by the query
--    in docs/SYSTEM.md ("Urgent stock storage").

-- CreateEnum
CREATE TYPE "LostFoundGuestSource" AS ENUM ('BOOKING', 'MANUAL');

-- AlterTable
ALTER TABLE "LostFoundItem" ADD COLUMN     "guestEmail" TEXT,
ADD COLUMN     "guestSource" "LostFoundGuestSource",
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "storageLocation" TEXT;

-- CreateTable
CREATE TABLE "UrgentStockNeed" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "propertyName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "observedCount" DOUBLE PRECISION,
    "purchaseQuantity" DOUBLE PRECISION,
    "observedAt" TEXT,
    "observationDisposition" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "lastReminderAt" TIMESTAMP(3),
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "reportedById" TEXT,
    "reportedByName" TEXT,
    "openPairKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrgentStockNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrgentStockEvent" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "note" TEXT,
    "detail" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrgentStockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UrgentStockNeed_openPairKey_key" ON "UrgentStockNeed"("openPairKey");

-- CreateIndex
CREATE INDEX "UrgentStockNeed_propertyId_stage_idx" ON "UrgentStockNeed"("propertyId", "stage");

-- CreateIndex
CREATE INDEX "UrgentStockNeed_stage_updatedAt_idx" ON "UrgentStockNeed"("stage", "updatedAt");

-- CreateIndex
CREATE INDEX "UrgentStockEvent_needId_createdAt_idx" ON "UrgentStockEvent"("needId", "createdAt");

-- CreateIndex
CREATE INDEX "LostFoundItem_reservationId_idx" ON "LostFoundItem"("reservationId");

-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockNeed" ADD CONSTRAINT "UrgentStockNeed_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockEvent" ADD CONSTRAINT "UrgentStockEvent_needId_fkey" FOREIGN KEY ("needId") REFERENCES "UrgentStockNeed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Lost and found backfill ────────────────────────────────────────────────

-- (a) No guest text at all, and the item's job has a booking with a name or
--     phone: copy the departing guest from that booking.
UPDATE "LostFoundItem" AS i
SET "guestName" = NULLIF(BTRIM(r."guestName"), ''),
    "guestContact" = NULLIF(BTRIM(r."guestPhone"), ''),
    "guestEmail" = NULLIF(BTRIM(r."guestEmail"), ''),
    "reservationId" = r."id",
    "guestSource" = 'BOOKING'
FROM "Job" AS j
JOIN "Reservation" AS r ON r."id" = j."reservationId"
WHERE j."id" = i."jobId"
  AND BTRIM(COALESCE(i."guestName", '')) = ''
  AND BTRIM(COALESCE(i."guestContact", '')) = ''
  AND (BTRIM(COALESCE(r."guestName", '')) <> '' OR BTRIM(COALESCE(r."guestPhone", '')) <> '');

-- (b) Guest text already present: only the office can have typed it. Mark it
--     MANUAL so nothing later replaces it; the guest text itself is untouched.
UPDATE "LostFoundItem"
SET "guestSource" = 'MANUAL'
WHERE "guestSource" IS NULL
  AND (BTRIM(COALESCE("guestName", '')) <> '' OR BTRIM(COALESCE("guestContact", '')) <> '');

-- ─── Urgent stock copy ──────────────────────────────────────────────────────

-- Reads a stored ISO timestamp as UTC; anything unreadable is NULL (never an
-- error that would abort the copy, never a made-up time).
CREATE FUNCTION "_sneek_urgent_stock_utc"(value TEXT) RETURNS TIMESTAMP(3)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN
    RETURN NULL;
  END IF;
  RETURN (value::timestamptz AT TIME ZONE 'UTC')::timestamp(3);
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

-- A JSON value that is absent, null or a number (never a string or object).
CREATE FUNCTION "_sneek_urgent_stock_optional_number"(value JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT value IS NULL OR jsonb_typeof(value) IN ('null', 'number')
$$;

INSERT INTO "UrgentStockNeed" (
  "id", "propertyId", "itemId", "propertyName", "itemName", "unit", "stage", "version",
  "observedCount", "purchaseQuantity", "observedAt", "observationDisposition", "note",
  "lastReminderAt", "remindersSent", "reportedById", "reportedByName", "openPairKey",
  "createdAt", "updatedAt"
)
SELECT
  a.value->>'id',
  a.value->>'propertyId',
  a.value->>'itemId',
  a.value->>'propertyName',
  a.value->>'itemName',
  a.value->>'unit',
  a.value->>'stage',
  (a.value->>'version')::INTEGER,
  CASE WHEN jsonb_typeof(a.value->'observedCount') = 'number' THEN (a.value->>'observedCount')::DOUBLE PRECISION END,
  CASE WHEN jsonb_typeof(a.value->'purchaseQuantity') = 'number' THEN (a.value->>'purchaseQuantity')::DOUBLE PRECISION END,
  CASE WHEN jsonb_typeof(a.value->'observedAt') = 'string' THEN a.value->>'observedAt' END,
  a.value->>'observationDisposition',
  a.value->>'note',
  "_sneek_urgent_stock_utc"(a.value->>'lastReminderAt'),
  (a.value->>'remindersSent')::INTEGER,
  reporter.actor_id,
  reporter.actor_name,
  NULL,
  "_sneek_urgent_stock_utc"(a.value->>'createdAt'),
  "_sneek_urgent_stock_utc"(a.value->>'updatedAt')
FROM "AppSetting" AS a
LEFT JOIN LATERAL (
  SELECT e.value->>'actorId' AS actor_id, e.value->>'actorName' AS actor_name
  FROM "AppSetting" AS e
  WHERE starts_with(e.key, 'urgent_stock_v1:event:' || (a.value->>'id') || ':')
    AND jsonb_typeof(e.value) = 'object'
    AND e.value->>'kind' = 'REPORTED'
  ORDER BY e."createdAt" ASC, e.key ASC
  LIMIT 1
) AS reporter ON TRUE
WHERE starts_with(a.key, 'urgent_stock_v1:need:')
  AND jsonb_typeof(a.value) = 'object'
  AND jsonb_typeof(a.value->'id') = 'string'
  AND a.key = 'urgent_stock_v1:need:' || (a.value->>'id')
  AND jsonb_typeof(a.value->'propertyId') = 'string'
  AND EXISTS (SELECT 1 FROM "Property" AS p WHERE p."id" = a.value->>'propertyId')
  AND jsonb_typeof(a.value->'itemId') = 'string'
  AND jsonb_typeof(a.value->'propertyName') = 'string'
  AND jsonb_typeof(a.value->'itemName') = 'string'
  AND jsonb_typeof(a.value->'unit') = 'string'
  AND a.value->>'stage' IN ('REPORTED', 'ACKNOWLEDGED', 'ORDERED', 'DELIVERED', 'PROPERTY_CONFIRMED', 'ADMIN_RESOLVED')
  AND jsonb_typeof(a.value->'version') = 'number' AND (a.value->>'version') ~ '^[1-9][0-9]{0,8}$'
  AND jsonb_typeof(a.value->'remindersSent') = 'number' AND (a.value->>'remindersSent') ~ '^[0-9]{1,9}$'
  AND jsonb_typeof(a.value->'observationDisposition') = 'string'
  AND jsonb_typeof(a.value->'note') = 'string'
  AND "_sneek_urgent_stock_optional_number"(a.value->'observedCount')
  AND "_sneek_urgent_stock_optional_number"(a.value->'purchaseQuantity')
  AND (a.value->'observedAt' IS NULL OR jsonb_typeof(a.value->'observedAt') IN ('null', 'string'))
  AND (a.value->'lastReminderAt' IS NULL OR jsonb_typeof(a.value->'lastReminderAt') = 'null'
       OR "_sneek_urgent_stock_utc"(a.value->>'lastReminderAt') IS NOT NULL)
  AND "_sneek_urgent_stock_utc"(a.value->>'createdAt') IS NOT NULL
  AND "_sneek_urgent_stock_utc"(a.value->>'updatedAt') IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- The open pointer (`urgent_stock_v1:open:<hash of property and item>`) becomes
-- the need's openPairKey, unchanged, so a new report still finds the open need.
UPDATE "UrgentStockNeed" AS n
SET "openPairKey" = pointer.key
FROM (
  SELECT DISTINCT ON (a.value->>'id') a.key, a.value->>'id' AS need_id
  FROM "AppSetting" AS a
  WHERE starts_with(a.key, 'urgent_stock_v1:open:')
    AND jsonb_typeof(a.value) = 'object'
    AND jsonb_typeof(a.value->'id') = 'string'
  ORDER BY a.value->>'id', a."updatedAt" DESC, a.key
) AS pointer
WHERE pointer.need_id = n."id";

INSERT INTO "UrgentStockEvent" (
  "id", "needId", "propertyId", "actorId", "actorName", "kind", "fromStage", "toStage", "note", "detail", "at", "createdAt"
)
SELECT
  substring(a.key FROM '^urgent_stock_v1:event:[^:]+:([^:]+)$'),
  n."id",
  n."propertyId",
  CASE WHEN jsonb_typeof(a.value->'actorId') = 'string' THEN a.value->>'actorId' END,
  a.value->>'actorName',
  a.value->>'kind',
  NULL,
  CASE WHEN a.value->>'kind' IN ('ACKNOWLEDGED', 'ORDERED', 'DELIVERED', 'PROPERTY_CONFIRMED', 'ADMIN_RESOLVED') THEN a.value->>'kind' END,
  CASE
    WHEN jsonb_typeof(a.value->'detail') <> 'object' THEN NULL
    WHEN a.value->>'kind' IN ('ACKNOWLEDGED', 'ORDERED', 'DELIVERED', 'PROPERTY_CONFIRMED', 'ADMIN_RESOLVED') THEN a.value->'detail'->>'reason'
    WHEN a.value->>'kind' IN ('REPORTED', 'REPORT_UPDATED') THEN a.value->'detail'->>'note'
  END,
  a.value->'detail',
  "_sneek_urgent_stock_utc"(a.value->>'at'),
  a."createdAt"
FROM "AppSetting" AS a
JOIN "UrgentStockNeed" AS n ON n."id" = substring(a.key FROM '^urgent_stock_v1:event:([^:]+):[^:]+$')
WHERE starts_with(a.key, 'urgent_stock_v1:event:')
  AND jsonb_typeof(a.value) = 'object'
  AND a.value->>'reportId' = n."id"
  AND a.value->>'propertyId' = n."propertyId"
  AND jsonb_typeof(a.value->'kind') = 'string'
  AND jsonb_typeof(a.value->'actorName') = 'string'
  AND (a.value->'actorId' IS NULL OR jsonb_typeof(a.value->'actorId') IN ('null', 'string'))
  AND a.value->'detail' IS NOT NULL
  AND "_sneek_urgent_stock_utc"(a.value->>'at') IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

DROP FUNCTION "_sneek_urgent_stock_optional_number"(JSONB);
DROP FUNCTION "_sneek_urgent_stock_utc"(TEXT);
