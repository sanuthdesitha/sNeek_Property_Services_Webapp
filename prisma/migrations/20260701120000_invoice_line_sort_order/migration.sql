-- Admin-controlled ordering of invoice lines (group by property + drag to reorder).
ALTER TABLE "ClientInvoiceLine" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
