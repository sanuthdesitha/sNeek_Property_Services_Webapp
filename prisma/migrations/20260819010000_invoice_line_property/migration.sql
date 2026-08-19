-- Group an invoice's MANUAL lines under a property.
--
-- A job-backed line already knows its property through the job, and that link
-- is the truthful one — this column is never meant to override it. It exists
-- for hand-added charges (jobId NULL), which until now had no property at all
-- and so all sank into a single "Other charges" bucket when the admin grouped
-- an invoice by property.
--
-- ON DELETE SET NULL, deliberately not CASCADE: removing a property must never
-- delete a line that has been billed to a client. The line simply loses its
-- grouping hint and falls back to "Other charges".
--
-- Additive only — one nullable column, one index, one FK. No existing row
-- changes and no backfill, so this is safe to run against a live database with
-- traffic.

-- AlterTable
ALTER TABLE "ClientInvoiceLine" ADD COLUMN "propertyId" TEXT;

-- CreateIndex
CREATE INDEX "ClientInvoiceLine_propertyId_idx" ON "ClientInvoiceLine"("propertyId");

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
