-- Per-person email preferences.
--
-- Until now the only controls were global: a master switch, a per-kind switch,
-- and a per-audience switch. So silencing one person's job reminders meant
-- silencing every cleaner's, and the answer to "stop emailing me about X" was
-- either nothing or a blunt instrument aimed at their whole role.
--
-- Absence of a row means ALLOWED. That is deliberate: this table only ever
-- records a deviation from the global setting, so it starts empty and nothing
-- about today's behaviour changes until someone opts out.
CREATE TABLE IF NOT EXISTS "UserEmailPreference" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserEmailPreference_pkey" PRIMARY KEY ("id")
);

-- One row per person per kind. The unique key is what makes the write an
-- upsert rather than an ever-growing log of toggles.
CREATE UNIQUE INDEX IF NOT EXISTS "UserEmailPreference_userId_key_key"
  ON "UserEmailPreference"("userId", "key");

CREATE INDEX IF NOT EXISTS "UserEmailPreference_userId_idx"
  ON "UserEmailPreference"("userId");

DO $$
BEGIN
  ALTER TABLE "UserEmailPreference"
    ADD CONSTRAINT "UserEmailPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- "Stop emailing me entirely." A single flag rather than a row per kind,
-- because it must keep working when new kinds are added later — a per-kind
-- opt-out list would silently start letting new kinds through.
--
-- It does NOT cover auth and recovery mail (password reset, OTP, 2FA); those
-- send with `critical` and bypass every preference, or someone would lock
-- themselves out of their own account by ticking a box.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "allEmailOff" BOOLEAN NOT NULL DEFAULT false;
