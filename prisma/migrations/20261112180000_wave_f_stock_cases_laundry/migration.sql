-- Wave F (2026-11-12): urgent stock (job on a need, shopping run link, ask a
-- cleaner to buy), stock count observations from job forms, case charges on
-- invoice lines, laundry planned pickup / drop clock times.
-- Forward only and data preserving: new nullable columns, new tables, and one
-- backfill that only fills empty columns where the job is certain.

-- AlterTable
ALTER TABLE "ClientInvoiceLine" ADD COLUMN     "caseId" TEXT;

-- AlterTable
ALTER TABLE "LaundryTask" ADD COLUMN     "dropoffTime" VARCHAR(5),
ADD COLUMN     "pickupTime" VARCHAR(5);

-- AlterTable
ALTER TABLE "UrgentStockNeed" ADD COLUMN     "shoppingRunAddedAt" TIMESTAMP(3),
ADD COLUMN     "shoppingRunAddedById" TEXT,
ADD COLUMN     "shoppingRunId" TEXT,
ADD COLUMN     "sourceJobId" TEXT,
ADD COLUMN     "sourceSubmissionId" TEXT;

-- CreateTable
CREATE TABLE "UrgentStockPurchaseAsk" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "cleanerName" TEXT NOT NULL,
    "jobId" TEXT,
    "state" TEXT NOT NULL,
    "activeKey" TEXT,
    "askedById" TEXT NOT NULL,
    "askedByName" TEXT NOT NULL,
    "note" TEXT,
    "quantity" DOUBLE PRECISION,
    "transports" JSONB NOT NULL,
    "outcomes" JSONB,
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "shoppingRunId" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrgentStockPurchaseAsk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountObservation" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "jobId" TEXT,
    "propertyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT,
    "fieldId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT,
    "count" DOUBLE PRECISION NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "previousOnHand" DOUBLE PRECISION,
    "stockTxId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCountObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UrgentStockPurchaseAsk_activeKey_key" ON "UrgentStockPurchaseAsk"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "UrgentStockPurchaseAsk_requestKey_key" ON "UrgentStockPurchaseAsk"("requestKey");

-- CreateIndex
CREATE INDEX "UrgentStockPurchaseAsk_needId_createdAt_idx" ON "UrgentStockPurchaseAsk"("needId", "createdAt");

-- CreateIndex
CREATE INDEX "UrgentStockPurchaseAsk_cleanerId_state_idx" ON "UrgentStockPurchaseAsk"("cleanerId", "state");

-- CreateIndex
CREATE INDEX "StockCountObservation_jobId_status_idx" ON "StockCountObservation"("jobId", "status");

-- CreateIndex
CREATE INDEX "StockCountObservation_propertyId_itemId_status_idx" ON "StockCountObservation"("propertyId", "itemId", "status");

-- CreateIndex
CREATE INDEX "StockCountObservation_status_createdAt_idx" ON "StockCountObservation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountObservation_submissionId_itemId_key" ON "StockCountObservation"("submissionId", "itemId");

-- CreateIndex
CREATE INDEX "ClientInvoiceLine_caseId_idx" ON "ClientInvoiceLine"("caseId");

-- CreateIndex
CREATE INDEX "UrgentStockNeed_sourceJobId_idx" ON "UrgentStockNeed"("sourceJobId");

-- CreateIndex
CREATE INDEX "UrgentStockNeed_shoppingRunId_idx" ON "UrgentStockNeed"("shoppingRunId");

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockNeed" ADD CONSTRAINT "UrgentStockNeed_sourceJobId_fkey" FOREIGN KEY ("sourceJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockNeed" ADD CONSTRAINT "UrgentStockNeed_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockNeed" ADD CONSTRAINT "UrgentStockNeed_shoppingRunId_fkey" FOREIGN KEY ("shoppingRunId") REFERENCES "ShoppingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockPurchaseAsk" ADD CONSTRAINT "UrgentStockPurchaseAsk_needId_fkey" FOREIGN KEY ("needId") REFERENCES "UrgentStockNeed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockPurchaseAsk" ADD CONSTRAINT "UrgentStockPurchaseAsk_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentStockPurchaseAsk" ADD CONSTRAINT "UrgentStockPurchaseAsk_shoppingRunId_fkey" FOREIGN KEY ("shoppingRunId") REFERENCES "ShoppingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountObservation" ADD CONSTRAINT "StockCountObservation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountObservation" ADD CONSTRAINT "StockCountObservation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Planned clock times are "HH:mm" (24 hour) or NULL; never a guessed value.
ALTER TABLE "LaundryTask" ADD CONSTRAINT "LaundryTask_pickupTime_format" CHECK ("pickupTime" IS NULL OR "pickupTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "LaundryTask" ADD CONSTRAINT "LaundryTask_dropoffTime_format" CHECK ("dropoffTime" IS NULL OR "dropoffTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Backfill the job on existing needs ONLY where it is certain: the need's first
-- REPORTED event was raised by a job form ("... Submission <id>.", written by
-- lib/cleaner/submission-urgent-stock.ts), that submission exists, belongs to a
-- job at the need's property and was submitted by the need's recorded reporter.
-- Every other need keeps NULL and reads "Reported by <name>".
WITH first_report AS (
  SELECT DISTINCT ON (e."needId") e."needId", e."detail"->>'note' AS note
  FROM "UrgentStockEvent" e
  WHERE e."kind" = 'REPORTED'
  ORDER BY e."needId", e."createdAt", e."id"
), parsed AS (
  SELECT f."needId", substring(f.note FROM 'Submission ([A-Za-z0-9_-]+)\.$') AS submission_id
  FROM first_report f
)
UPDATE "UrgentStockNeed" n
SET "sourceSubmissionId" = s."id", "sourceJobId" = s."jobId"
FROM parsed p
JOIN "FormSubmission" s ON s."id" = p.submission_id
JOIN "Job" j ON j."id" = s."jobId"
WHERE n."id" = p."needId"
  AND p.submission_id IS NOT NULL
  AND n."sourceJobId" IS NULL
  AND n."reportedById" IS NOT NULL
  AND s."submittedById" = n."reportedById"
  AND j."propertyId" = n."propertyId";
