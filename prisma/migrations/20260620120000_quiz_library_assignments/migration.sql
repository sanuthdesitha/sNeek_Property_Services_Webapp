-- CreateEnum
CREATE TYPE "QuizAssignmentStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "QuizTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAssignment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "quizTemplateId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "QuizAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION,
    "result" JSONB,
    "answers" JSONB,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuizAssignment_token_key" ON "QuizAssignment"("token");

-- CreateIndex
CREATE INDEX "QuizAssignment_applicationId_idx" ON "QuizAssignment"("applicationId");

-- CreateIndex
CREATE INDEX "QuizAssignment_token_idx" ON "QuizAssignment"("token");

-- AddForeignKey
ALTER TABLE "QuizAssignment" ADD CONSTRAINT "QuizAssignment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAssignment" ADD CONSTRAINT "QuizAssignment_quizTemplateId_fkey" FOREIGN KEY ("quizTemplateId") REFERENCES "QuizTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
