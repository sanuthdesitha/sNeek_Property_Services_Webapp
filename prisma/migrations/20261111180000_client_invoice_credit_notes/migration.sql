-- Money step (c): credit notes, client reference, note to client, discount basis.
-- Additive only. Every existing ClientInvoice becomes kind INVOICE with no
-- credited invoice, reference or note; every existing line keeps a null
-- discountPercent. No stored amount, number, status or payment is touched.

-- CreateEnum
CREATE TYPE "ClientInvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "clientNote" TEXT,
ADD COLUMN     "clientReference" VARCHAR(100),
ADD COLUMN     "creditsInvoiceId" TEXT,
ADD COLUMN     "kind" "ClientInvoiceKind" NOT NULL DEFAULT 'INVOICE';

-- AlterTable
ALTER TABLE "ClientInvoiceLine" ADD COLUMN     "discountPercent" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "ClientInvoice_creditsInvoiceId_idx" ON "ClientInvoice"("creditsInvoiceId");

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_creditsInvoiceId_fkey" FOREIGN KEY ("creditsInvoiceId") REFERENCES "ClientInvoice"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- A credit note always names the invoice it credits, and only a credit note
-- does. Not modelled by Prisma, so it never shows as schema drift.
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_credit_note_link_check"
  CHECK (("kind" = 'CREDIT_NOTE') = ("creditsInvoiceId" IS NOT NULL));
