-- One person, more than one job.
--
-- The business has people who clean AND inspect, or drive laundry AND clean.
-- Until now that meant either two logins or a role that lied about half of what
-- they do. `User.role` stays the PRIMARY role — it decides which portal they
-- land in, every historical row was written against it, and turning it into an
-- array would have meant rewriting 848 authorisation call sites in one change.
-- This table holds the extra hats.
--
-- A JOIN TABLE RATHER THAN AN ARRAY COLUMN, because each grant carries its own
-- provenance: when it was given and by whom. An array of enums cannot answer
-- "who made this person an inspector, and when" — and for a role that unlocks
-- the ability to score somebody else's work, that question gets asked.
--
-- REVOKING IS DELETING. There is deliberately no `removedAt` here, unlike
-- JobAssignment: a role somebody no longer holds must stop granting access
-- immediately and completely, and a soft-deleted row is one forgotten WHERE
-- clause away from still granting it. The audit log records the revocation.
--
-- The unique constraint means granting the same role twice is not two grants.
--
-- Additive: a new table only. No existing row is touched, no column changes,
-- and an account with no rows here behaves exactly as it did before.

CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRole_userId_role_key" ON "UserRole"("userId", "role");
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: deleting the admin who granted a role must never
-- silently revoke the role they granted.
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
