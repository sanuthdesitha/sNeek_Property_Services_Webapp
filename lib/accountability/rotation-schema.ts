/** Runtime rotation operates on immutable published templates. Keep the full
 * catalogue for counter advancement, even when a field is not due this visit. */
export function collectRotationalItems(schema: any): Array<{ key: string; rotationEveryNCleans: number }> {
  const items = new Map<string, number>();
  const visit = (field: any) => {
    if (typeof field?.id === "string" && field.frequency === "ROTATIONAL") {
      const key = field.id.replace(/__(?:bed|bath)\d+$/, "");
      const cadence = Number(field.rotationEveryNCleans ?? 4);
      if (Number.isInteger(cadence) && cadence > 0) items.set(key, cadence);
    }
    if (Array.isArray(field?.children)) field.children.forEach(visit);
  };
  for (const section of schema?.sections ?? []) for (const field of section.fields ?? []) visit(field);
  return Array.from(items, ([key, rotationEveryNCleans]) => ({ key, rotationEveryNCleans }));
}

export function filterRotationalSchema<T>(schema: T, states: Array<{ itemKey: string; cleansSinceDone: number }>): T {
  if (!schema || typeof schema !== "object" || !Array.isArray((schema as any).sections)) return schema;
  const byKey = new Map(states.map((state) => [state.itemKey, state.cleansSinceDone]));
  const filterFields = (fields: any[]): any[] => fields.flatMap((field) => {
    if (field.frequency === "ROTATIONAL") {
      const key = String(field.id).replace(/__(?:bed|bath)\d+$/, "");
      const cadence = Number(field.rotationEveryNCleans ?? 4);
      const count = byKey.get(key);
      if (!Number.isInteger(cadence) || cadence <= 0 || (count !== undefined && count + 1 < cadence)) return [];
    }
    return [{ ...field, ...(Array.isArray(field.children) ? { children: filterFields(field.children) } : {}) }];
  });
  return { ...schema, sections: (schema as any).sections.map((section: any) => ({ ...section, fields: filterFields(section.fields ?? []) })) };
}
