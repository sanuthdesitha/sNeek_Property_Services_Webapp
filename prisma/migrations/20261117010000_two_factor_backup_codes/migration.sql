-- Two-step backup codes as single-use rows (2026-11-17).
-- Additive: a new table. Existing unused codes are kept: the sha256 hashes
-- in "User"."twoFactorBackupCodes" (a JSON array) are copied as
-- hashScheme 'sha256-legacy' rows with an unrecorded creation time, then the
-- old column is cleared (nothing reads it any more). A row whose JSON cannot
-- be read is left untouched in the old column rather than guessed at.

-- CreateTable
CREATE TABLE "TwoFactorBackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "hashScheme" TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "TwoFactorBackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwoFactorBackupCode_userId_usedAt_idx" ON "TwoFactorBackupCode"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactorBackupCode_userId_codeHash_key" ON "TwoFactorBackupCode"("userId", "codeHash");

-- AddForeignKey
ALTER TABLE "TwoFactorBackupCode" ADD CONSTRAINT "TwoFactorBackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy older sets (only for people who still have two-step on).
DO $$
DECLARE
  person RECORD;
  hashes JSONB;
BEGIN
  FOR person IN
    SELECT "id", "twoFactorBackupCodes" AS raw
    FROM "User"
    WHERE "twoFactorEnabled" = true AND "twoFactorBackupCodes" IS NOT NULL
  LOOP
    BEGIN
      hashes := person.raw::jsonb;
    EXCEPTION WHEN others THEN
      hashes := NULL;
    END;
    IF hashes IS NOT NULL AND jsonb_typeof(hashes) = 'array' THEN
      INSERT INTO "TwoFactorBackupCode" ("id", "userId", "setId", "codeHash", "hashScheme", "createdAt", "usedAt")
      SELECT DISTINCT ON (element)
        'legacy_' || md5(person."id" || ':' || element),
        person."id",
        'legacy_' || person."id",
        element,
        'sha256-legacy',
        NULL,
        NULL
      FROM jsonb_array_elements_text(hashes) AS element
      WHERE element ~ '^[0-9a-f]{64}$'
      ON CONFLICT ("userId", "codeHash") DO NOTHING;
      UPDATE "User" SET "twoFactorBackupCodes" = NULL WHERE "id" = person."id";
    END IF;
  END LOOP;
END $$;

-- People with two-step off keep no codes.
UPDATE "User" SET "twoFactorBackupCodes" = NULL
WHERE "twoFactorEnabled" = false AND "twoFactorBackupCodes" IS NOT NULL;
