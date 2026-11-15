-- Onboarding workspace (2026-11-16): revision counter and structured sections on
-- the survey, answer history (office vs client) and no-login client links.
-- Additive only: no column, table or row is dropped.

ALTER TABLE "PropertyOnboardingSurvey"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "workspace" JSONB,
  ADD COLUMN "lastSavedAt" TIMESTAMP(3),
  ADD COLUMN "lastSavedById" TEXT,
  ADD COLUMN "lastSavedSource" "OnboardingSourceType";

CREATE TABLE "OnboardingAnswerRevision" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "OnboardingSourceType" NOT NULL,
    "actorUserId" TEXT,
    "clientLinkId" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingAnswerRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingClientLink" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sections" TEXT[],
    "transport" TEXT NOT NULL,
    "recipientMasked" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "deliveryState" TEXT,
    "deliveryError" TEXT,

    CONSTRAINT "OnboardingClientLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingAnswerRevision_surveyId_revision_key" ON "OnboardingAnswerRevision"("surveyId", "revision");
CREATE INDEX "OnboardingAnswerRevision_surveyId_createdAt_idx" ON "OnboardingAnswerRevision"("surveyId", "createdAt");
CREATE UNIQUE INDEX "OnboardingClientLink_tokenHash_key" ON "OnboardingClientLink"("tokenHash");
CREATE INDEX "OnboardingClientLink_surveyId_createdAt_idx" ON "OnboardingClientLink"("surveyId", "createdAt");

ALTER TABLE "OnboardingAnswerRevision" ADD CONSTRAINT "OnboardingAnswerRevision_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PropertyOnboardingSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingClientLink" ADD CONSTRAINT "OnboardingClientLink_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "PropertyOnboardingSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The free-text bed configuration becomes a structured room list. Existing text
-- is kept twice: it stays where it was (scenarios.bedConfig, still copied to the
-- property notes on activation) and is shown as the room list's note.
UPDATE "PropertyOnboardingSurvey"
SET "workspace" = jsonb_build_object(
  'version', 1,
  'rooms', jsonb_build_object('list', '[]'::jsonb, 'note', btrim("adminOverrides"->'formMeta'->'scenarios'->>'bedConfig'))
)
WHERE "workspace" IS NULL
  AND jsonb_typeof("adminOverrides") = 'object'
  AND COALESCE(btrim("adminOverrides"->'formMeta'->'scenarios'->>'bedConfig'), '') <> '';
