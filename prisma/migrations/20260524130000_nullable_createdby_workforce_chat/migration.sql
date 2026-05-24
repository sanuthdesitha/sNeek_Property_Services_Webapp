-- WorkforcePost
ALTER TABLE "WorkforcePost" DROP CONSTRAINT IF EXISTS "WorkforcePost_createdById_fkey";
ALTER TABLE "WorkforcePost" ALTER COLUMN "createdById" DROP NOT NULL;
-- Scrub existing orphans to null so the new FK doesn't fail
UPDATE "WorkforcePost"
SET "createdById" = NULL
WHERE "createdById" NOT IN (SELECT "id" FROM "User");
ALTER TABLE "WorkforcePost"
  ADD CONSTRAINT "WorkforcePost_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ChatChannel
ALTER TABLE "ChatChannel" DROP CONSTRAINT IF EXISTS "ChatChannel_createdById_fkey";
ALTER TABLE "ChatChannel" ALTER COLUMN "createdById" DROP NOT NULL;
UPDATE "ChatChannel"
SET "createdById" = NULL
WHERE "createdById" NOT IN (SELECT "id" FROM "User");
ALTER TABLE "ChatChannel"
  ADD CONSTRAINT "ChatChannel_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
