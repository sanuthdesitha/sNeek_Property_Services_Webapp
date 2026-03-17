import { db } from "@/lib/db";

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

export async function createTemplateVersion(templateId: string) {
  const { current, templates } = await loadGroupByTemplateId(templateId);
  if (!current) throw new Error("Template not found.");
  const source = templates.find((row) => row.id === templateId);
  if (!source) throw new Error("Template not found in its version group.");

  const nextVersion =
    templates.length > 0
      ? Math.max(...templates.map((row) => Number(row.version || 1))) + 1
      : (Number(source.version || 1) + 1);

  const created = await db.formTemplate.create({
    data: {
      name: withVersion(source.name, nextVersion),
      serviceType: source.serviceType,
      version: nextVersion,
      isActive: true,
      schema: source.schema as any,
    },
  });

  await db.formTemplate.updateMany({
    where: {
      id: { in: templates.map((row) => row.id).filter((id) => id !== created.id) },
    },
    data: { isActive: false },
  });

  return created;
}

export async function rollbackTemplateVersion(templateId: string, targetTemplateId: string) {
  const { current, templates } = await loadGroupByTemplateId(templateId);
  if (!current) throw new Error("Template not found.");
  const exists = templates.find((row) => row.id === targetTemplateId);
  if (!exists) throw new Error("Target version not found in this template family.");

  await db.$transaction([
    db.formTemplate.updateMany({
      where: {
        id: { in: templates.map((row) => row.id) },
      },
      data: { isActive: false },
    }),
    db.formTemplate.update({
      where: { id: targetTemplateId },
      data: { isActive: true },
    }),
  ]);

  return db.formTemplate.findUnique({
    where: { id: targetTemplateId },
  });
}
