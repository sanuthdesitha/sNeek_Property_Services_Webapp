-- CreateEnum
CREATE TYPE "LaundryOutcome" AS ENUM ('READY_FOR_PICKUP', 'NOT_READY', 'NO_PICKUP_REQUIRED');

-- CreateEnum
CREATE TYPE "ShoppingRunStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUBMITTED', 'APPROVED', 'BILLED', 'REIMBURSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ShoppingPaymentMethod" AS ENUM ('COMPANY_CARD', 'CLIENT_CARD', 'CLEANER_CARD', 'ADMIN_CARD', 'CASH', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "ShoppingPaidByScope" AS ENUM ('COMPANY', 'CLIENT', 'CLEANER', 'ADMIN', 'OTHER');

-- CreateEnum
CREATE TYPE "StockRunStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUBMITTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "ClientInvoiceStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'PAID', 'VOID');

-- DropForeignKey
ALTER TABLE "IssueTicket" DROP CONSTRAINT "IssueTicket_jobId_fkey";

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "laundryAdminOverrideAt" TIMESTAMP(3),
ADD COLUMN     "laundryAdminOverrideById" TEXT,
ADD COLUMN     "laundryAdminOverrideNote" TEXT,
ADD COLUMN     "laundryOutcome" "LaundryOutcome",
ADD COLUMN     "laundrySkipReasonCode" TEXT,
ADD COLUMN     "laundrySkipReasonNote" TEXT;

-- AlterTable
ALTER TABLE "IssueTicket" ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "caseType" TEXT NOT NULL DEFAULT 'OPS',
ADD COLUMN     "clientCanReply" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "propertyId" TEXT,
ADD COLUMN     "reportId" TEXT,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "source" TEXT,
ALTER COLUMN "jobId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "priorityBucket" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "priorityReason" TEXT,
ADD COLUMN     "sameDayCheckin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sameDayCheckinTime" TEXT;

-- AlterTable
ALTER TABLE "LaundryTask" ADD COLUMN     "adminOverrideAt" TIMESTAMP(3),
ADD COLUMN     "adminOverrideById" TEXT,
ADD COLUMN     "adminOverrideNote" TEXT,
ADD COLUMN     "noPickupRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "skipReasonCode" TEXT,
ADD COLUMN     "skipReasonNote" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "cleanerVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "laundryVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visibilityNote" TEXT,
ADD COLUMN     "visibilityUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "visibilityUpdatedById" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "adults" INTEGER,
ADD COLUMN     "checkinAtLocal" TIMESTAMP(3),
ADD COLUMN     "checkoutAtLocal" TIMESTAMP(3),
ADD COLUMN     "children" INTEGER,
ADD COLUMN     "geoLat" DOUBLE PRECISION,
ADD COLUMN     "geoLng" DOUBLE PRECISION,
ADD COLUMN     "guestEmail" TEXT,
ADD COLUMN     "guestPhone" TEXT,
ADD COLUMN     "guestProfileUrl" TEXT,
ADD COLUMN     "infants" INTEGER,
ADD COLUMN     "locationText" TEXT,
ADD COLUMN     "reservationCode" TEXT;

-- CreateTable
CREATE TABLE "CaseComment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAttachment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingRun" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "status" "ShoppingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "legacySource" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingRunLine" (
    "id" TEXT NOT NULL,
    "shoppingRunId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "supplier" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "plannedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchasedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION,
    "lineCost" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingReceipt" (
    "id" TEXT NOT NULL,
    "shoppingRunId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingSettlement" (
    "id" TEXT NOT NULL,
    "shoppingRunId" TEXT NOT NULL,
    "paymentMethod" "ShoppingPaymentMethod" NOT NULL,
    "paidByScope" "ShoppingPaidByScope" NOT NULL,
    "paidByUserId" TEXT,
    "note" TEXT,
    "clientBillable" BOOLEAN NOT NULL DEFAULT false,
    "adminApprovedForClient" BOOLEAN NOT NULL DEFAULT false,
    "adminApprovedForCleanerReimbursement" BOOLEAN NOT NULL DEFAULT false,
    "includeInCleanerInvoice" BOOLEAN NOT NULL DEFAULT false,
    "includedInClientInvoiceId" TEXT,
    "includedInCleanerInvoiceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRun" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "StockRunStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "requestedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRunLine" (
    "id" TEXT NOT NULL,
    "stockRunId" TEXT NOT NULL,
    "propertyStockId" TEXT NOT NULL,
    "expectedOnHand" DOUBLE PRECISION NOT NULL,
    "countedOnHand" DOUBLE PRECISION,
    "parLevel" DOUBLE PRECISION,
    "reorderThreshold" DOUBLE PRECISION,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyClientRate" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "baseCharge" DOUBLE PRECISION NOT NULL,
    "billingUnit" TEXT NOT NULL DEFAULT 'PER_JOB',
    "defaultDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyClientRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInvoice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "ClientInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xeroExportedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "jobId" TEXT,
    "shoppingRunId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "userId" TEXT NOT NULL,
    "categories" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyClientRate_propertyId_jobType_key" ON "PropertyClientRate"("propertyId", "jobType");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvoice_invoiceNumber_key" ON "ClientInvoice"("invoiceNumber");

-- AddForeignKey
ALTER TABLE "IssueTicket" ADD CONSTRAINT "IssueTicket_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTicket" ADD CONSTRAINT "IssueTicket_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTicket" ADD CONSTRAINT "IssueTicket_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTicket" ADD CONSTRAINT "IssueTicket_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTicket" ADD CONSTRAINT "IssueTicket_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_visibilityUpdatedById_fkey" FOREIGN KEY ("visibilityUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseComment" ADD CONSTRAINT "CaseComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseComment" ADD CONSTRAINT "CaseComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAttachment" ADD CONSTRAINT "CaseAttachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAttachment" ADD CONSTRAINT "CaseAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRun" ADD CONSTRAINT "ShoppingRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRun" ADD CONSTRAINT "ShoppingRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRunLine" ADD CONSTRAINT "ShoppingRunLine_shoppingRunId_fkey" FOREIGN KEY ("shoppingRunId") REFERENCES "ShoppingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRunLine" ADD CONSTRAINT "ShoppingRunLine_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRunLine" ADD CONSTRAINT "ShoppingRunLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingReceipt" ADD CONSTRAINT "ShoppingReceipt_shoppingRunId_fkey" FOREIGN KEY ("shoppingRunId") REFERENCES "ShoppingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingReceipt" ADD CONSTRAINT "ShoppingReceipt_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingSettlement" ADD CONSTRAINT "ShoppingSettlement_shoppingRunId_fkey" FOREIGN KEY ("shoppingRunId") REFERENCES "ShoppingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingSettlement" ADD CONSTRAINT "ShoppingSettlement_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingSettlement" ADD CONSTRAINT "ShoppingSettlement_includedInClientInvoiceId_fkey" FOREIGN KEY ("includedInClientInvoiceId") REFERENCES "ClientInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRun" ADD CONSTRAINT "StockRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRun" ADD CONSTRAINT "StockRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRunLine" ADD CONSTRAINT "StockRunLine_stockRunId_fkey" FOREIGN KEY ("stockRunId") REFERENCES "StockRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRunLine" ADD CONSTRAINT "StockRunLine_propertyStockId_fkey" FOREIGN KEY ("propertyStockId") REFERENCES "PropertyStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyClientRate" ADD CONSTRAINT "PropertyClientRate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_shoppingRunId_fkey" FOREIGN KEY ("shoppingRunId") REFERENCES "ShoppingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
