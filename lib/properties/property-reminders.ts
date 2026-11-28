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

/**
 * An open QA issue at the property, read out before the clean (pilot
 * "Before-you-start extras", 2026-11-28). Loaded on the server.
 */
export type OpenQaIssueReminder = { id: string; category: string; description: string };

/**
 * The property facts the rules read. `features` is Property.features (amenity
 * JSON); `openQaIssues` is present only where the pilot loaded them.
 */
export type PropertyReminderSource = { features?: unknown; openQaIssues?: OpenQaIssueReminder[] } | null | undefined;

export const QA_ISSUE_REMINDER_PREFIX = "property-reminder-qa-";
const QA_DESCRIPTION_MAX = 160;

function categoryLabel(category: string): string {
  const words = category.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Quality";
}

function qaIssueReminders(property: PropertyReminderSource): PropertyReminder[] {
  const issues = Array.isArray(property?.openQaIssues) ? property!.openQaIssues : [];
  return issues.map((issue) => {
    const description = issue.description.trim();
    const short = description.length > QA_DESCRIPTION_MAX ? `${description.slice(0, QA_DESCRIPTION_MAX - 1)}…` : description;
    return {
      id: `${QA_ISSUE_REMINDER_PREFIX}${issue.id}`,
      title: `Open QA issue here: ${categoryLabel(issue.category)}`,
      ...(short ? { detail: `Check it is fixed this time: ${short}` } : {}),
    };
  });
}

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
  const fromFacts = features
    ? PROPERTY_REMINDER_RULES
        .filter((rule) => rule.applies(features))
        .map((rule) => ({ id: rule.id, title: rule.title, ...(rule.detail ? { detail: rule.detail } : {}) }))
    : [];
  return [...fromFacts, ...qaIssueReminders(property)];
}

export function isPropertyReminderId(itemId: string): boolean {
  return itemId.startsWith("property-reminder-");
}
