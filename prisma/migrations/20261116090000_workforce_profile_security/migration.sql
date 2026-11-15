-- Your profile (2026-11-16): recorded sign-ins, "sign out everywhere else"
-- and the two-step sign-in requirement for administrators. Additive only.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "twoStepRequiredSince" TIMESTAMP(3),
ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserSignIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "UserSignIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSignIn_userId_revokedAt_idx" ON "UserSignIn"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "UserSignIn" ADD CONSTRAINT "UserSignIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
