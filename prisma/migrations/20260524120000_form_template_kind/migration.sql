CREATE TYPE "FormKind" AS ENUM (
  'AIRBNB_TURNOVER',
  'END_OF_LEASE',
  'DEEP_CLEAN',
  'REGULAR_MAINTENANCE',
  'POST_CONSTRUCTION',
  'WINDOW',
  'CARPET',
  'COMMERCIAL',
  'MOVE_IN',
  'OVEN',
  'CUSTOM'
);

ALTER TABLE "FormTemplate" ADD COLUMN "kind" "FormKind" NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "FormTemplate" ADD COLUMN "parentTemplateId" TEXT;
ALTER TABLE "FormTemplate" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "FormTemplate" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "FormTemplate_kind_isActive_idx" ON "FormTemplate"("kind", "isActive");

ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_parentTemplateId_fkey"
  FOREIGN KEY ("parentTemplateId") REFERENCES "FormTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
