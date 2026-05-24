-- Single-use invitation tokens so admins can create accounts that send the recipient
-- a link to set their own password, instead of admins choosing a password manually.
CREATE TABLE IF NOT EXISTS "UserInvitation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserInvitation_userId_key" ON "UserInvitation"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserInvitation_token_key" ON "UserInvitation"("token");
CREATE INDEX IF NOT EXISTS "UserInvitation_expiresAt_idx" ON "UserInvitation"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
