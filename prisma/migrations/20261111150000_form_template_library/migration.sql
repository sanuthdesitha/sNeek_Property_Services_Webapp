-- Forms library: groups, tags and version history for form templates.
--
-- Nothing existing is rewritten. FormTemplate keeps every row and its current
-- schema, and job-form resolution keeps reading FormTemplate.schema only.
-- Each existing template gets ONE baseline version row copied from its current
-- schema, name, service type and version number, dated at the template's last
-- update (the latest moment that schema can have been written), so history has
-- a starting point. Drafts written later never change what cleaners receive.
BEGIN;

-- CreateEnum
CREATE TYPE "FormTemplateVersionKind" AS ENUM ('PUBLISHED', 'DRAFT');

-- AlterTable
ALTER TABLE "FormTemplate" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "FormTemplateGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplateGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" "FormTemplateVersionKind" NOT NULL DEFAULT 'PUBLISHED',
    "version" INTEGER NOT NULL,
    "schema" JSONB NOT NULL,
    "name" TEXT,
    "serviceType" "JobType",
    "note" TEXT,
    "restoredFromVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormTemplateGroup_sortOrder_idx" ON "FormTemplateGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "FormTemplateVersion_templateId_createdAt_idx" ON "FormTemplateVersion"("templateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplateVersion_templateId_kind_version_key" ON "FormTemplateVersion"("templateId", "kind", "version");

-- CreateIndex
CREATE INDEX "FormTemplate_groupId_idx" ON "FormTemplate"("groupId");

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FormTemplateGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplateVersion" ADD CONSTRAINT "FormTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Baseline history: one row per existing template, copied verbatim.
INSERT INTO "FormTemplateVersion" (
    "id", "templateId", "kind", "version", "schema", "name", "serviceType",
    "note", "createdAt", "updatedAt"
)
SELECT
    'ftvbase_' || substr(md5(t."id"), 1, 24),
    t."id",
    'PUBLISHED',
    t."version",
    t."schema",
    t."name",
    t."serviceType",
    CASE
        WHEN t."archivedAt" IS NOT NULL THEN 'Baseline copied when version history started (template was archived)'
        WHEN t."isActive" THEN 'Baseline copied when version history started (template was live)'
        ELSE 'Baseline copied when version history started (template was an unpublished draft)'
    END,
    t."updatedAt",
    t."updatedAt"
FROM "FormTemplate" t
ON CONFLICT ("templateId", "kind", "version") DO NOTHING;

COMMIT;
