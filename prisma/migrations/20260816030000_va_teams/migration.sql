-- V1 — virtual-assistant logins acting on behalf of a client.
--
-- Additive only: one enum value, one table, one nullable column. No existing
-- row changes and no backfill is needed, so this is safe to run against a live
-- database with traffic.
--
-- NOTE ON THE ENUM: PostgreSQL cannot USE a newly added enum value in the same
-- transaction that adds it (and before PG12 could not add one inside a
-- transaction at all). This migration only ADDS 'VA' — nothing here defaults to
-- it or inserts it — so it is safe under Prisma's transactional runner. If a
-- later migration needs to write Role.VA, it must be a SEPARATE migration file.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'VA';

-- CreateTable
CREATE TABLE "VaTeam" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "permissions" JSONB NOT NULL,
    "propertyIds" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaTeam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaTeam_clientId_isActive_idx" ON "VaTeam"("clientId", "isActive");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "vaTeamId" TEXT;

-- CreateIndex
CREATE INDEX "User_vaTeamId_idx" ON "User"("vaTeamId");

-- AddForeignKey
-- CASCADE: a VA team is meaningless without the client it acts for.
ALTER TABLE "VaTeam" ADD CONSTRAINT "VaTeam_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: the record of who granted the access must survive.
ALTER TABLE "VaTeam" ADD CONSTRAINT "VaTeam_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL: deleting a team must not delete the people. Their login survives
-- with no team, which the chokepoint treats as "no access" rather than "all
-- access" — see lib/auth/client-portal.ts.
ALTER TABLE "User" ADD CONSTRAINT "User_vaTeamId_fkey" FOREIGN KEY ("vaTeamId") REFERENCES "VaTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
