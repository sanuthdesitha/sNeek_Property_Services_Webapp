CREATE TABLE "ShoppingClientCharge" (
"id" TEXT NOT NULL PRIMARY KEY, "shoppingRunId" TEXT NOT NULL, "propertyId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL,
"expenseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0, "shoppingMinutes" INTEGER NOT NULL DEFAULT 0, "hourlyRate" DOUBLE PRECISION, "labourAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
"treatment" TEXT NOT NULL DEFAULT 'PENDING', "status" TEXT NOT NULL DEFAULT 'DRAFT', "revision" INTEGER NOT NULL DEFAULT 0,
"approvedAt" TIMESTAMP(3), "approvedById" TEXT, "reviewNote" TEXT, "invoiceId" TEXT, "billedAt" TIMESTAMP(3), "billingSnapshot" JSONB,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "ShoppingClientCharge_shoppingRunId_fkey" FOREIGN KEY ("shoppingRunId") REFERENCES "ShoppingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "ShoppingClientCharge_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "ShoppingClientCharge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "ShoppingClientCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "ShoppingClientCharge_shoppingRunId_sourceKey_key" ON "ShoppingClientCharge"("shoppingRunId","sourceKey");
CREATE INDEX "ShoppingClientCharge_clientId_status_invoiceId_idx" ON "ShoppingClientCharge"("clientId","status","invoiceId");
CREATE INDEX "ShoppingClientCharge_propertyId_idx" ON "ShoppingClientCharge"("propertyId");
ALTER TABLE "ClientInvoiceLine" ADD COLUMN "shoppingClientChargeId" TEXT;
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_shoppingClientChargeId_fkey" FOREIGN KEY ("shoppingClientChargeId") REFERENCES "ShoppingClientCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShoppingRunLine" ADD COLUMN "shoppingMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShoppingClientCharge" ADD COLUMN "allocatedMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShoppingClientCharge" ADD COLUMN "expenseBillable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShoppingClientCharge" ADD COLUMN "allocatedExpenseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
