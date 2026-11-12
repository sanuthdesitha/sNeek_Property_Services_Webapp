-- Invitations are revocable (owner decision 2026-11-13). Two nullable columns
-- and a foreign key; no default and no backfill: every existing invitation is
-- simply not revoked. A resend clears both (a fresh invitation).
ALTER TABLE "UserInvitation" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "UserInvitation" ADD COLUMN "revokedById" TEXT;

ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
