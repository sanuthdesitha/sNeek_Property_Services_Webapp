-- AlterTable
ALTER TABLE "PropertyOnboardingSurvey" ADD COLUMN "laundrySupplierId" TEXT;
ALTER TABLE "PropertyOnboardingSurvey" ADD COLUMN "createdLaundryTaskId" TEXT;

-- AddForeignKey
ALTER TABLE "PropertyOnboardingSurvey" ADD CONSTRAINT "PropertyOnboardingSurvey_laundrySupplierId_fkey" FOREIGN KEY ("laundrySupplierId") REFERENCES "LaundrySupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
