-- Phase 1c prep: give User a nullable organization membership.
-- Nullable + additive, so it is safe to apply to the live DB. The full
-- organizationId rollout onto the other tenant-owned models (Phase 1b) is a
-- separate migration, applied with the leak audit.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
