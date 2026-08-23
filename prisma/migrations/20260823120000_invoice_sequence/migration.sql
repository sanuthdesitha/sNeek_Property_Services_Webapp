-- Invoices get real numbers.
--
-- A client invoice was named `INV-<yyyyMMdd>-<6 random hex>` and a cleaner's
-- invoice was not named at all. Random is not a number: an accountant asked for
-- "invoice 41" cannot find it, cannot tell whether 40 and 42 exist, and cannot
-- show an auditor that nothing was removed from the middle. A gap in a sequence
-- is information; a gap between two random strings is nothing.
--
-- One row per rail. They number SEPARATELY because money in and money out are
-- different documents sent to different people; interleaving them would give a
-- client invoice 7 and a cleaner invoice 8 with nothing in common.
--
-- A TABLE, not a settings field. Allocation is one atomic UPDATE ... RETURNING,
-- so two invoices generated in the same second cannot be handed the same
-- number. A read-modify-write against the settings JSON could not promise that.
--
-- `lastNumber` is the last number ISSUED; the next is lastNumber + 1. Seeded at
-- 0 so nothing is presumed about the owner's existing paperwork — they set the
-- real starting point in Settings before the first invoice goes out.

CREATE TABLE "InvoiceSequence" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT 'INV-',
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "padding" INTEGER NOT NULL DEFAULT 4,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("key")
);

INSERT INTO "InvoiceSequence" ("key", "prefix", "lastNumber", "padding", "updatedAt")
VALUES ('CLIENT', 'INV-', 0, 4, CURRENT_TIMESTAMP),
       ('CLEANER', 'PAY-', 0, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Nullable: every submission made before numbering existed has none, and
-- back-filling would invent numbers that were never on a document anyone sent.
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "invoiceNumber" TEXT;
CREATE UNIQUE INDEX "CleanerInvoiceSubmission_invoiceNumber_key"
    ON "CleanerInvoiceSubmission"("invoiceNumber");
