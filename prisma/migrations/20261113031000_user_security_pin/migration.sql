-- Each administrator and operations manager has their OWN sensitive-action PIN.
--
-- Until now a PIN hash lived inside the "user_extended_profiles_v1" settings
-- JSON (read-modify-write, capped list). It moves to its own row per person so
-- the hash, the wrong-attempt count and the lockout can be written atomically.
-- Existing personal PIN hashes are copied across unchanged, so everyone who
-- already had a PIN keeps it. The settings JSON is left as it was (no data is
-- deleted); the application no longer reads the PIN from it.

CREATE TABLE "UserSecurityPin" (
    "userId" TEXT NOT NULL,
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3),
    "resetById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSecurityPin_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserSecurityPin" ADD CONSTRAINT "UserSecurityPin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy existing personal PIN hashes (only bcrypt-shaped values, only for
-- accounts that still exist). The set time is kept when it reads as a date.
INSERT INTO "UserSecurityPin" ("userId", "pinHash", "pinSetAt", "updatedAt")
SELECT DISTINCT ON (u."id")
       u."id",
       profile->>'adminPinHash',
       CASE
         WHEN COALESCE(profile->>'adminPinUpdatedAt', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
         THEN ((profile->>'adminPinUpdatedAt')::timestamptz AT TIME ZONE 'UTC')
         ELSE NULL
       END,
       CURRENT_TIMESTAMP
  FROM "AppSetting" AS s
 CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(s."value"::jsonb -> 'profiles') = 'array'
              THEN s."value"::jsonb -> 'profiles'
              ELSE '[]'::jsonb END
       ) AS profile
  JOIN "User" AS u ON u."id" = profile->>'userId'
 WHERE s."key" = 'user_extended_profiles_v1'
   AND COALESCE(profile->>'adminPinHash', '') ~ '^\$2[aby]\$\d{2}\$.{53}$'
 ORDER BY u."id"
ON CONFLICT ("userId") DO NOTHING;
