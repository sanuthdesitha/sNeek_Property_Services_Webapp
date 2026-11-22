-- Personal notification switches (2026-11-21): one two-way preference model
-- for every portal. Additive only: nullable JSON columns and a revision
-- counter on the two existing personal preference tables. No existing value
-- is rewritten, so every opt-out already stored keeps its meaning.

-- AlterTable
ALTER TABLE "UserNotificationPreference" ADD COLUMN     "switchChanges" JSONB,
ADD COLUMN     "switchRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "switches" JSONB;

-- AlterTable
ALTER TABLE "ClientNotificationPreference" ADD COLUMN     "switchChanges" JSONB,
ADD COLUMN     "switchRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "switches" JSONB;
