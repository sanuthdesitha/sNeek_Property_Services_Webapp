import { db } from "@/lib/db";

/**
 * Read-only view of the OLD "versioning": sibling FormTemplate rows named
 * "… vN" in the same service type. Its write half (create a sibling version,
 * roll back by switching `isActive`) was removed on 2026-11-11: it had no
 * screen and switching `isActive` changes which form jobs resolve to.
 * Version history, drafts and restore live in the Forms library
 * (`lib/forms/template-history.ts`, `/api/admin/form-templates/[id]/versions`).
 */
export const LEGACY_TEMPLATE_VERSION_WRITES_GONE =
  "This old template-versions API no longer changes forms. Use the Forms library: " +
  "open the form's version history (GET /api/admin/form-templates/{id}/versions) and restore a " +
  "version as a draft (POST /api/admin/form-templates/{id}/versions/{versionId}/restore), then publish it.";

function normalizeName(name: string) {
  return name.trim().replace(/\s+v\d+$/i, "").trim();
}

function withVersion(name: string, version: number) {
  const base = normalizeName(name);
  return `${base} v${version}`;
}

async function loadGroupByTemplateId(templateId: string) {
  const current = await db.formTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, serviceType: true },
  });
  if (!current) return { current: null, templates: [] as any[] };
  const base = normalizeName(current.name);
  const templates = await db.formTemplate.findMany({
    where: {
      serviceType: current.serviceType,
      name: {
        startsWith: base,
      },
    },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
  });
  const filtered = templates.filter((row) => normalizeName(row.name) === base);
  return { current, templates: filtered };
}

export async function listTemplateVersions(templateId: string) {
  const { current, templates } = await loadGroupByTemplateId(templateId);
  if (!current) return { baseName: null, templates: [] as any[] };
  return {
    baseName: normalizeName(current.name),
    templates,
  };
}
