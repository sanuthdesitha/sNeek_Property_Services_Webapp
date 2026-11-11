/**
 * Which ACTIVE QA templates compete for the same job type and scope, and which
 * one an inspection would get. Mirrors lib/qa/template-resolution.ts:
 * among active templates of one job type with the same property (or none =
 * global), the highest `version` is used (`findFirst … orderBy version desc`).
 * A property template always beats the global one for that property, so a
 * global and a property template never conflict.
 *
 * PURE: client-safe.
 */
export type QaTemplateLike = {
  id: string;
  name: string;
  serviceType: string;
  propertyId: string | null;
  version: number;
  isActive: boolean;
};

export type QaTemplateConflict = {
  serviceType: string;
  propertyId: string | null;
  templateIds: string[];
  /** The template inspections resolve to; null when the top versions tie (the database picks either). */
  resolvesToId: string | null;
};

export function qaScopeKey(template: Pick<QaTemplateLike, "serviceType" | "propertyId">): string {
  return `${template.serviceType}::${template.propertyId ?? "global"}`;
}

export function findQaTemplateConflicts(templates: readonly QaTemplateLike[]): QaTemplateConflict[] {
  const groups = new Map<string, QaTemplateLike[]>();
  for (const template of templates) {
    if (!template.isActive) continue;
    const key = qaScopeKey(template);
    groups.set(key, [...(groups.get(key) ?? []), template]);
  }
  const conflicts: QaTemplateConflict[] = [];
  groups.forEach((group) => {
    if (group.length < 2) return;
    const sorted = group.slice().sort((a, b) => b.version - a.version);
    const tie = sorted[0].version === sorted[1].version;
    conflicts.push({
      serviceType: sorted[0].serviceType,
      propertyId: sorted[0].propertyId,
      templateIds: sorted.map((template) => template.id),
      resolvesToId: tie ? null : sorted[0].id,
    });
  });
  return conflicts;
}
