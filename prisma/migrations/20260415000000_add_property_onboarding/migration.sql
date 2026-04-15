-- CreateEnum
CREATE TYPE "OnboardingSurveyStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OnboardingSourceType" AS ENUM ('ADMIN_CREATED', 'CLIENT_SUBMITTED', 'WEB_FORM');

-- CreateTable
CREATE TABLE "PropertyOnboardingSurvey" (
    "id" TEXT NOT NULL,
    "surveyNumber" TEXT NOT NULL,
    "sourceType" "OnboardingSourceType" NOT NULL DEFAULT 'ADMIN_CREATED',
    "status" "OnboardingSurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "adminReviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "isNewClient" BOOLEAN NOT NULL DEFAULT false,
    "clientData" JSONB,
    "existingClientId" TEXT,
    "propertyAddress" TEXT,
    "propertySuburb" TEXT,
    "propertyState" TEXT NOT NULL DEFAULT 'NSW',
    "propertyPostcode" TEXT,
    "propertyName" TEXT,
    "propertyNotes" TEXT,
    "bedrooms" INTEGER NOT NULL DEFAULT 1,
    "bathrooms" INTEGER NOT NULL DEFAULT 1,
    "hasBalcony" BOOLEAN NOT NULL DEFAULT false,
    "floorCount" INTEGER NOT NULL DEFAULT 1,
    "propertyType" TEXT,
    "sizeSqm" DOUBLE PRECISION,
    "requestedCleanerCount" INTEGER NOT NULL DEFAULT 1,
    "estimatedCleanerCount" INTEGER,
    "estimatedHours" DOUBLE PRECISION,
    "estimatedPrice" DOUBLE PRECISION,
    "icalUrl" TEXT,
    "icalProvider" "IntegrationProvider",
    "adminNotes" TEXT,
    "adminOverrides" JSONB,
    "createdClientId" TEXT,
    "createdPropertyId" TEXT,
    "createdIntegrationId" TEXT,
    "createdJobIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "PropertyOnboardingSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingAppliance" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "applianceType" TEXT NOT NULL,
    "conditionNote" TEXT,
    "requiresClean" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OnboardingAppliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingSpecialRequest" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "area" TEXT,

    CONSTRAINT "OnboardingSpecialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingLaundryDetail" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "hasLaundry" BOOLEAN NOT NULL DEFAULT false,
    "washerType" TEXT,
    "dryerType" TEXT,
    "laundryLocation" TEXT,
    "suppliesProvided" BOOLEAN NOT NULL DEFAULT false,
    "detergentType" TEXT,
    "notes" TEXT,

    CONSTRAINT "OnboardingLaundryDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingAccessDetail" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "detailType" TEXT NOT NULL,
    "value" TEXT,
    "photoUrl" TEXT,
    "photoKey" TEXT,
    "annotations" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OnboardingAccessDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingJobTypeAnswer" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "answers" JSONB NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OnboardingJobTypeAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyOnboardingSurvey_surveyNumber_key" ON "PropertyOnboardingSurvey"("surveyNumber");

-- CreateIndex
CREATE INDEX "PropertyOnboardingSurvey_status_createdAt_idx" ON "PropertyOnboardingSurvey"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PropertyOnboardingSurvey_sourceType_status_idx" ON "PropertyOnboardingSurvey"("sourceType", "status");

-- CreateIndex
CREATE INDEX "PropertyOnboardingSurvey_existingClientId_idx" ON "PropertyOnboardingSurvey"("existingClientId");

-- CreateIndex
CREATE INDEX "PropertyOnboardingSurvey_createdPropertyId_idx" ON "PropertyOnboardingSurvey"("createdPropertyId");

-- CreateIndex
CREATE INDEX "OnboardingAppliance_surveyId_idx" ON "OnboardingAppliance"("surveyId");

-- CreateIndex
CREATE INDEX "OnboardingSpecialRequest_surveyId_idx" ON "OnboardingSpecialRequest"("surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingLaundryDetail_surveyId_key" ON "OnboardingLaundryDetail"("surveyId");

-- CreateIndex
CREATE INDEX "OnboardingAccessDetail_surveyId_idx" ON "OnboardingAccessDetail"("surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingJobTypeAnswer_surveyId_jobType_key" ON "OnboardingJobTypeAnswer"("surveyId", "jobType");

-- AddForeignKey
ALTER TABLE "PropertyOnboardingSurvey" ADD CONSTRAINT "PropertyOnboardingSurvey_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOnboardingSurvey" ADD CONSTRAINT "PropertyOnboardingSurvey_adminReviewerId_fkey" FOREIGN KEY ("adminReviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOnboardingSurvey" ADD CONSTRAINT "PropertyOnboardingSurvey_existingClientId_fkey" FOREIGN KEY ("existingClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyOnboardingSurvey" ADD CONSTRAINT "PropertyOnboardingSurvey_createdClientId_fkey" FOREIGN KEY ("createdClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingAppliance" ADD CONSTRAINT "OnboardingAppliance_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PropertyOnboardingSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingSpecialRequest" ADD CONSTRAINT "OnboardingSpecialRequest_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PropertyOnboardingSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingLaundryDetail" ADD CONSTRAINT "OnboardingLaundryDetail_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PropertyOnboardingSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingAccessDetail" ADD CONSTRAINT "OnboardingAccessDetail_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PropertyOnboardingSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingJobTypeAnswer" ADD CONSTRAINT "OnboardingJobTypeAnswer_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PropertyOnboardingSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
