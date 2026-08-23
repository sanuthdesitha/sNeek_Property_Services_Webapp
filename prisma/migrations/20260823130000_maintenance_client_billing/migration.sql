-- Client-paid maintenance reaches the client's invoice.
--
-- `MaintenanceItemAssignment.payPayer` has had two values since the day it was
-- added, and its own schema comment says "CLIENT means the amount also lands on
-- the client's invoice". Nothing implemented that. An admin could agree a $400
-- repair with a client, record CLIENT against it, mark it complete, pay the
-- worker — and the client was never billed a cent. The setting existed, read
-- correctly on every screen, and moved no money.
--
-- These two columns are the double-bill guard, and they are why this needs a
-- migration rather than just a query. Without a stamp, every invoice run would
-- re-bill the same repair: the second invoice would look exactly as legitimate
-- as the first, and the only person who would notice is the client.
--
-- Same shape as CleanerPayAdjustment.includedInCleanerInvoiceId and
-- ShoppingSettlement.includedInClientInvoiceId, which guard the same hazard on
-- the other two rails. Deliberately a plain nullable column rather than a
-- foreign key, matching those two: a deleted invoice must not cascade away the
-- record that this work was once billed.

ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "includedInClientInvoiceId" TEXT;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "includedInClientInvoiceAt" TIMESTAMP(3);

-- Serves the "what is billable for this client" scan on every invoice run.
CREATE INDEX "MaintenanceItemAssignment_includedInClientInvoiceId_idx"
    ON "MaintenanceItemAssignment"("includedInClientInvoiceId");
