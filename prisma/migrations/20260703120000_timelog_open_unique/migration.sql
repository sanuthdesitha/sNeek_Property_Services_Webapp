-- Race-safety: stop a cleaner double-clocking-in on the same job (two concurrent
-- "start" requests each found no open TimeLog and both created one, double-
-- counting time). A partial unique index enforces at most ONE open (stoppedAt
-- IS NULL) TimeLog per (jobId, userId). Prisma can't express a partial unique
-- index in schema.prisma, so this is a raw-SQL migration (documented next to the
-- TimeLog model in schema.prisma). The app also catches the unique violation
-- (P2002) on start and treats it as "already running".

-- 1) Clean up any EXISTING duplicate open logs first, or the index creation
--    would fail. Keep the earliest open log per (jobId, userId); close the rest.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "jobId", "userId"
      ORDER BY "startedAt" ASC, "id" ASC
    ) AS rn
  FROM "TimeLog"
  WHERE "stoppedAt" IS NULL
)
UPDATE "TimeLog" AS t
SET
  "stoppedAt" = now(),
  "durationM" = GREATEST(0, CAST(EXTRACT(EPOCH FROM (now() - t."startedAt")) / 60 AS INTEGER)),
  "notes" = COALESCE(t."notes", '') || ' [auto-closed duplicate open log during unique-index migration]'
FROM ranked
WHERE t."id" = ranked."id"
  AND ranked.rn > 1;

-- 2) Enforce one open TimeLog per job+user going forward.
CREATE UNIQUE INDEX IF NOT EXISTS "TimeLog_job_user_open_unique"
  ON "TimeLog" ("jobId", "userId")
  WHERE "stoppedAt" IS NULL;
