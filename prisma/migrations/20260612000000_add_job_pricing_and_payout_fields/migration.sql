-- Job: agreed fixed client price, client-invoice note, and actual completion date.
ALTER TABLE "Job"
  ADD COLUMN "fixedPrice" DOUBLE PRECISION,
  ADD COLUMN "invoiceNote" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3);

-- ClientInvoiceLine: per-job note snapshotted from Job.invoiceNote at generation time.
ALTER TABLE "ClientInvoiceLine"
  ADD COLUMN "note" TEXT;
