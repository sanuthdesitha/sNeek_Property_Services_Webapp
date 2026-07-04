-- CreateEnum
CREATE TYPE "TemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "TemplateDefinition" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SYSTEM',
    "publishedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "doc" JSONB NOT NULL,
    "status" "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderedDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "templateVersionId" TEXT,
    "docSnapshot" JSONB NOT NULL,
    "dataSnapshot" JSONB NOT NULL,
    "htmlKey" TEXT,
    "pdfKey" TEXT,
    "renderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateDefinition_publishedVersionId_key" ON "TemplateDefinition"("publishedVersionId");

-- CreateIndex
CREATE INDEX "TemplateDefinition_kind_idx" ON "TemplateDefinition"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateDefinition_kind_scope_key" ON "TemplateDefinition"("kind", "scope");

-- CreateIndex
CREATE INDEX "TemplateVersion_definitionId_status_idx" ON "TemplateVersion"("definitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_definitionId_version_key" ON "TemplateVersion"("definitionId", "version");

-- CreateIndex
CREATE INDEX "RenderedDocument_entityType_entityId_idx" ON "RenderedDocument"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "RenderedDocument_kind_renderedAt_idx" ON "RenderedDocument"("kind", "renderedAt");

-- AddForeignKey
ALTER TABLE "TemplateDefinition" ADD CONSTRAINT "TemplateDefinition_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "TemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "TemplateDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedDocument" ADD CONSTRAINT "RenderedDocument_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

