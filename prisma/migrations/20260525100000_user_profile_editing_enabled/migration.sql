-- Per-user toggle for profile editing — admins can disable per-user when needed.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileEditingEnabled" BOOLEAN NOT NULL DEFAULT true;
