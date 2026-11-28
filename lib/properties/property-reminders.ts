/**
 * PROPERTY REMINDERS — automatic instructions a property's own facts imply,
 * read out to the cleaner before every clean at that property without the
 * office adding a task (owner request 2026-11-28: live plants).
 *
 * Each rule reads one stored fact and, when it holds, yields one reminder with
 * a stable id. The start briefing (lib/forms/start-briefing.ts) lists them
 * under the source PROPERTY_REMINDER, so they are acknowledged before clock-in
 * like any other item, and the job screen lists them in Read first.
 *
 * Only live plants is built. Add further rules to PROPERTY_REMINDER_RULES.
 *
 * PURE — no DB, no I/O, safe on both sides.
 */

export type PropertyReminder = {
  /** Stable id; part of the briefing acknowledgement. */
  id: string;
  title: string;
  detail?: string;
};

/** The property facts the rules read. `features` is Property.features (amenity JSON). */
export type PropertyReminderSource = { features?: unknown } | null | undefined;

type PropertyReminderRule = {
  id: string;
  applies: (features: Record<string, unknown>) => boolean;
  title: string;
  detail?: string;
};

export const LIVE_PLANTS_REMINDER_ID = "property-reminder-live-plants";
export const LIVE_PLANTS_REMINDER_TEXT = "This property has live plants. Check the soil and water only if it is dry.";

const PROPERTY_REMINDER_RULES: readonly PropertyReminderRule[] = [
  {
    id: LIVE_PLANTS_REMINDER_ID,
    applies: (features) => features.livePlants === true,
    title: LIVE_PLANTS_REMINDER_TEXT,
  },
];

function featuresOf(property: PropertyReminderSource): Record<string, unknown> | null {
  const features = property?.features;
  if (!features || typeof features !== "object" || Array.isArray(features)) return null;
  return features as Record<string, unknown>;
}

/** The reminders that apply to this property, in rule order. Unknown facts give none. */
export function resolvePropertyReminders(property: PropertyReminderSource): PropertyReminder[] {
  const features = featuresOf(property);
  if (!features) return [];
  return PROPERTY_REMINDER_RULES
    .filter((rule) => rule.applies(features))
    .map((rule) => ({ id: rule.id, title: rule.title, ...(rule.detail ? { detail: rule.detail } : {}) }));
}

export function isPropertyReminderId(itemId: string): boolean {
  return itemId.startsWith("property-reminder-");
}
