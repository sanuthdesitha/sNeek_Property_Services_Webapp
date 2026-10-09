-- Reconcile committed migration history with the current Prisma contract.
-- Preserve existing rows, billing/team indexes and the BlogPost tags default.
-- RESTRICT protects historical QA/evidence when a job is deleted; SET NULL
-- retains shopping lines when their optional property is removed.
BEGIN;

-- DropForeignKey
ALTER TABLE "MediaOverrideRequest" DROP CONSTRAINT "MediaOverrideRequest_jobId_fkey";

-- DropForeignKey
ALTER TABLE "QaAssignment" DROP CONSTRAINT "QaAssignment_jobId_fkey";

-- DropForeignKey
ALTER TABLE "QaFormSubmission" DROP CONSTRAINT "QaFormSubmission_jobId_fkey";

-- DropForeignKey
ALTER TABLE "ShoppingRunLine" DROP CONSTRAINT "ShoppingRunLine_propertyId_fkey";

-- AlterTable
ALTER TABLE "PropertyOnboardingSurvey" ALTER COLUMN "icalProvider" SET DEFAULT 'ICAL_OTHER',
ALTER COLUMN "createdJobIds" SET DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "OnboardingJobTypeAnswer_surveyId_idx" ON "OnboardingJobTypeAnswer"("surveyId");

-- CreateIndex
CREATE INDEX "UserInvitation_token_idx" ON "UserInvitation"("token");

-- AddForeignKey
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaFormSubmission" ADD CONSTRAINT "QaFormSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaOverrideRequest" ADD CONSTRAINT "MediaOverrideRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingRunLine" ADD CONSTRAINT "ShoppingRunLine_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;


COMMIT;
