-- Client maintenance epic Phase 3: client-facing cost quote + approval.
ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN     "quotedCost" DOUBLE PRECISION;
ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN     "costApprovalStatus" TEXT;
ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN     "costDecidedAt" TIMESTAMP(3);
