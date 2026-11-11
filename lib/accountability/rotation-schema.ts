import { formatInTimeZone } from "date-fns-tz";

const REPEAT_SUFFIX = /__(?:bed|bath)\d+$/;

/** Runtime rotation operates on immutable published templates. Keep the full
 * catalogue for counter advancement, even when a field is not due this visit. */
export function collectRotationalItems(schema: any): Array<{ key: string; rotationEveryNCleans: number }> {
  const items = new Map<string, number>();
  const visit = (field: any) => {
    if (typeof field?.id === "string" && field.frequency === "ROTATIONAL") {
      const key = field.id.replace(REPEAT_SUFFIX, "");
      const cadence = Number(field.rotationEveryNCleans ?? 4);
      if (Number.isInteger(cadence) && cadence > 0) items.set(key, cadence);
    }
    if (Array.isArray(field?.children)) field.children.forEach(visit);
  };
  for (const section of schema?.sections ?? []) for (const field of section.fields ?? []) visit(field);
  return Array.from(items, ([key, rotationEveryNCleans]) => ({ key, rotationEveryNCleans }));
}

/**
 * "Monthly" questions (frequency "MONTHLY"): the item keys (room suffix
 * stripped, like rotation). Their per-property last-shown date is the existing
 * `PropertyRotationState.lastCompletedAt` of the same key — no schema change.
 */
export function collectMonthlyItems(schema: any): string[] {
  const keys = new Set<string>();
  const visit = (field: any) => {
    if (typeof field?.id === "string" && field.frequency === "MONTHLY") keys.add(field.id.replace(REPEAT_SUFFIX, ""));
    if (Array.isArray(field?.children)) field.children.forEach(visit);
  };
  for (const section of schema?.sections ?? []) for (const field of section?.fields ?? []) visit(field);
  return Array.from(keys);
}

/** Calendar month of an instant in the organisation timezone ("2026-11"). */
export function calendarMonthKey(at: Date, timeZone: string): string {
  return formatInTimeZone(at, timeZone, "yyyy-MM");
}

/**
 * A monthly question is due on the first counted clean of each calendar month
 * at the property: never shown there before, or last shown in an earlier
 * month (organisation timezone, so a clean at 00:30 on the 1st in Sydney is in
 * the new month whatever UTC says, across daylight-saving changes too).
 */
export function isMonthlyItemDue(lastShownAt: Date | null | undefined, now: Date, timeZone: string): boolean {
  if (!lastShownAt || !Number.isFinite(lastShownAt.getTime())) return true;
  return calendarMonthKey(lastShownAt, timeZone) !== calendarMonthKey(now, timeZone);
}

export type RotationStateRow = { itemKey: string; cleansSinceDone: number; lastCompletedAt?: Date | null };

/**
 * Hide rotating questions that are not due. "Every Nth clean" questions are
 * judged from `cleansSinceDone` exactly as before. "Monthly" questions are
 * judged only when `monthly` (the clock and timezone) is given; without it they
 * are shown, never silently hidden.
 */
export function filterRotationalSchema<T>(
  schema: T,
  states: RotationStateRow[],
  monthly?: { now: Date; timeZone: string },
): T {
  if (!schema || typeof schema !== "object" || !Array.isArray((schema as any).sections)) return schema;
  const byKey = new Map(states.map((state) => [state.itemKey, state]));
  const filterFields = (fields: any[]): any[] => fields.flatMap((field) => {
    const key = String(field.id).replace(REPEAT_SUFFIX, "");
    if (field.frequency === "ROTATIONAL") {
      const cadence = Number(field.rotationEveryNCleans ?? 4);
      const count = byKey.get(key)?.cleansSinceDone;
      if (!Number.isInteger(cadence) || cadence <= 0 || (count !== undefined && count + 1 < cadence)) return [];
    }
    if (field.frequency === "MONTHLY" && monthly && !isMonthlyItemDue(byKey.get(key)?.lastCompletedAt ?? null, monthly.now, monthly.timeZone)) {
      return [];
    }
    return [{ ...field, ...(Array.isArray(field.children) ? { children: filterFields(field.children) } : {}) }];
  });
  return { ...schema, sections: (schema as any).sections.map((section: any) => ({ ...section, fields: filterFields(section.fields ?? []) })) };
}
