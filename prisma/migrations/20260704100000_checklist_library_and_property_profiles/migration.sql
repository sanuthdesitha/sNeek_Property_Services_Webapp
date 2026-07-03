-- Per-property dynamic checklist system (all additive):
--   ChecklistModule / ChecklistModuleItem — the DB checklist library, organised
--     into rooms/appliances/outdoor/extras with auto-apply rules.
--   PropertyChecklistProfile — one profile per property: module/item on-off
--     selections (per-job-type item flags), custom items, approval + generated
--     FormTemplate linkage.
--   Property.features — amenity flags (dishwasher, oven, pool, ...) driving
--     module auto-selection; copied from the onboarding survey on approval.

-- AlterTable
ALTER TABLE "Property" ADD COLUMN "features" JSONB;

-- CreateTable
CREATE TABLE "ChecklistModule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ROOM',
    "description" TEXT,
    "appliesWhen" JSONB,
    "repeatBy" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistModule_key_key" ON "ChecklistModule"("key");

-- CreateIndex
CREATE INDEX "ChecklistModule_sortOrder_idx" ON "ChecklistModule"("sortOrder");

-- CreateTable
CREATE TABLE "ChecklistModuleItem" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "instructions" TEXT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "fieldType" TEXT NOT NULL DEFAULT 'checkbox',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "minPhotos" INTEGER,
    "stampTag" TEXT,
    "defaultOn" BOOLEAN NOT NULL DEFAULT true,
    "jobTypes" "JobType"[],
    "appliesWhen" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistModuleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistModuleItem_moduleId_key_key" ON "ChecklistModuleItem"("moduleId", "key");

-- CreateIndex
CREATE INDEX "ChecklistModuleItem_moduleId_sortOrder_idx" ON "ChecklistModuleItem"("moduleId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ChecklistModuleItem" ADD CONSTRAINT "ChecklistModuleItem_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "ChecklistModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PropertyChecklistProfile" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "selections" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "generatedTemplateIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyChecklistProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyChecklistProfile_propertyId_key" ON "PropertyChecklistProfile"("propertyId");

-- AddForeignKey
ALTER TABLE "PropertyChecklistProfile" ADD CONSTRAINT "PropertyChecklistProfile_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyChecklistProfile" ADD CONSTRAINT "PropertyChecklistProfile_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
