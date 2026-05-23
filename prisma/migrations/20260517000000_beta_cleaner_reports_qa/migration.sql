ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'QA_INSPECTOR';

CREATE TYPE "QaAssignmentStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MediaOverrideStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'RESOLVED');

ALTER TABLE "SubmissionMedia"
  ADD COLUMN "originalUrl" TEXT,
  ADD COLUMN "originalS3Key" TEXT,
  ADD COLUMN "annotatedUrl" TEXT,
  ADD COLUMN "annotatedS3Key" TEXT,
  ADD COLUMN "annotationData" JSONB;

CREATE TABLE "QaFormTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "serviceType" "JobType" NOT NULL,
  "propertyId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "schema" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QaFormTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaAssignment" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "assignedToId" TEXT,
  "createdById" TEXT,
  "pickedUpById" TEXT,
  "status" "QaAssignmentStatus" NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3),
  "pickedUpAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QaAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaFormSubmission" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "qaReviewId" TEXT,
  "submittedById" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "categoryScores" JSONB,
  "media" JSONB,
  "score" DOUBLE PRECISION NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QaFormSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaOverrideRequest" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "submissionId" TEXT,
  "requestedById" TEXT NOT NULL,
  "decidedById" TEXT,
  "fieldId" TEXT NOT NULL,
  "fieldLabel" TEXT,
  "reason" TEXT,
  "status" "MediaOverrideStatus" NOT NULL DEFAULT 'PENDING',
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaOverrideRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QaFormTemplate_serviceType_isActive_version_idx" ON "QaFormTemplate"("serviceType", "isActive", "version");
CREATE INDEX "QaFormTemplate_propertyId_serviceType_isActive_idx" ON "QaFormTemplate"("propertyId", "serviceType", "isActive");
CREATE INDEX "QaAssignment_status_dueAt_idx" ON "QaAssignment"("status", "dueAt");
CREATE INDEX "QaAssignment_assignedToId_status_idx" ON "QaAssignment"("assignedToId", "status");
CREATE INDEX "QaAssignment_jobId_status_idx" ON "QaAssignment"("jobId", "status");
CREATE INDEX "QaFormSubmission_jobId_createdAt_idx" ON "QaFormSubmission"("jobId", "createdAt");
CREATE INDEX "QaFormSubmission_submittedById_createdAt_idx" ON "QaFormSubmission"("submittedById", "createdAt");
CREATE INDEX "MediaOverrideRequest_jobId_status_idx" ON "MediaOverrideRequest"("jobId", "status");
CREATE INDEX "MediaOverrideRequest_requestedById_status_idx" ON "MediaOverrideRequest"("requestedById", "status");
CREATE UNIQUE INDEX "MediaOverrideRequest_jobId_requestedById_fieldId_status_key" ON "MediaOverrideRequest"("jobId", "requestedById", "fieldId", "status");

ALTER TABLE "QAReview" ADD CONSTRAINT "QAReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaFormTemplate" ADD CONSTRAINT "QaFormTemplate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_pickedUpById_fkey" FOREIGN KEY ("pickedUpById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaFormSubmission" ADD CONSTRAINT "QaFormSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QaFormSubmission" ADD CONSTRAINT "QaFormSubmission_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QaFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QaFormSubmission" ADD CONSTRAINT "QaFormSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "QaAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaFormSubmission" ADD CONSTRAINT "QaFormSubmission_qaReviewId_fkey" FOREIGN KEY ("qaReviewId") REFERENCES "QAReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QaFormSubmission" ADD CONSTRAINT "QaFormSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaOverrideRequest" ADD CONSTRAINT "MediaOverrideRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaOverrideRequest" ADD CONSTRAINT "MediaOverrideRequest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaOverrideRequest" ADD CONSTRAINT "MediaOverrideRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaOverrideRequest" ADD CONSTRAINT "MediaOverrideRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
