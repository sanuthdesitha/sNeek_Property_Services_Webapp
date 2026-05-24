CREATE TYPE "ReportThemeKind" AS ENUM ('COMPACT', 'MAGAZINE', 'DETAILED', 'CUSTOM');

CREATE TABLE "ReportTheme" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "ReportThemeKind" NOT NULL DEFAULT 'CUSTOM',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "layout" JSONB NOT NULL,
  "logoUrl" TEXT,
  "primaryColorHsl" TEXT,
  "accentColorHsl" TEXT,
  "titleTemplate" TEXT,
  "footerHtml" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportTheme_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportTheme_isActive_idx" ON "ReportTheme"("isActive");
CREATE INDEX "ReportTheme_isDefault_idx" ON "ReportTheme"("isDefault");

ALTER TABLE "ReportTheme"
  ADD CONSTRAINT "ReportTheme_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Report" ADD COLUMN "themeId" TEXT;
CREATE INDEX "Report_themeId_idx" ON "Report"("themeId");
ALTER TABLE "Report"
  ADD CONSTRAINT "Report_themeId_fkey"
  FOREIGN KEY ("themeId") REFERENCES "ReportTheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
