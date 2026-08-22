-- Maintenance assignments become work someone can actually do.
--
-- The assignment row already existed and already emailed the assignee, but it
-- was write-only from the office's side: a cleaner or QA inspector could see
-- the item and had no way to accept it, decline it, or record that it was done.
--
-- LIFECYCLE. An assignment is an OFFER until accepted. Without that
-- distinction an admin cannot tell "they have seen it and are coming" from "it
-- is sitting unread" — exactly the difference that matters at 7am with a tenant
-- waiting.
--
-- PAY. Fixed or hourly, because a tap washer is a price and a repaint is a day
-- rate. `payPayer` records who is footing it: CLIENT means the amount also
-- reaches the client's invoice, since they agreed to cover it.
--
-- `payChange*` is the assignee saying the price is wrong. The request is kept
-- whatever the outcome — a pattern of quoted work being disputed is worth
-- seeing, and deleting declined requests hides it.
--
-- INSTRUCTIONS live on the ITEM, not the assignment: a maintenance worker, a
-- cleaner and a QA inspector on the same job all need the same access notes,
-- and copying them per assignment guarantees they drift. Json rather than
-- columns because the business keeps finding new things worth saying, and each
-- one would otherwise be a migration.

ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "declinedAt" TIMESTAMP(3);
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "declineReason" TEXT;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "completionNote" TEXT;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "completionPhotoKeys" JSONB;

ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payType" TEXT;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payAmount" DOUBLE PRECISION;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payHours" DOUBLE PRECISION;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payPayer" TEXT;

ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payChangeAmount" DOUBLE PRECISION;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payChangeReason" TEXT;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payChangeStatus" TEXT;
ALTER TABLE "MaintenanceItemAssignment" ADD COLUMN "payChangeAt" TIMESTAMP(3);

ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN "assignmentInstructions" JSONB;
