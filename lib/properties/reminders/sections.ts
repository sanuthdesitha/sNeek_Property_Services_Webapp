/**
 * Room sections for property reminders (smart property reminders, 2026-11-28).
 *
 * A room reminder names a room key (kitchen, bathroom, …). It is shown at the
 * top of the first form section that carries that room by a STABLE marker:
 * a field's `evidenceCategory`, the section's `repeatBy`, a stock question
 * type, or a known built-in section id. Label text is never read. A reminder
 * whose room the form lacks is not shown in a room at all.
 *
 * PURE — no DB, no I/O, safe on both sides.
 */
import { LAUNDRY_AREA_SECTION } from "@/lib/forms/laundry-area";

export const REMINDER_ROOM_KEYS = ["kitchen", "bathroom", "bedroom", "living", "balcony", "laundry", "supplies", "lockup"] as const;
export type ReminderRoomKey = (typeof REMINDER_ROOM_KEYS)[number];

export const REMINDER_ROOM_LABEL: Record<ReminderRoomKey, string> = {
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  bedroom: "Bedroom",
  living: "Living area",
  balcony: "Balcony or outdoor",
  laundry: "Laundry",
  supplies: "Supplies and stock",
  lockup: "Final walk-through and lock-up",
};

export function isReminderRoomKey(value: unknown): value is ReminderRoomKey {
  return typeof value === "string" && (REMINDER_ROOM_KEYS as readonly string[]).includes(value);
}

/** Field evidenceCategory (checklist taxonomy) → room key. */
const EVIDENCE_CATEGORY_ROOM: Record<string, ReminderRoomKey> = {
  KITCHEN: "kitchen",
  BATHROOM: "bathroom",
  BEDROOM: "bedroom",
  LIVING: "living",
  OUTDOOR: "balcony",
  LAUNDRY_CONFIRM: "laundry",
  FINAL: "lockup",
};

const SUPPLY_FIELD_TYPES = new Set(["inventory", "stock_count", "stock_table"]);

type MarkerField = { type?: unknown; evidenceCategory?: unknown; children?: unknown };
export type ReminderSchemaSection = { id: string; repeatBy?: unknown; fields?: unknown };

function fieldsOneLevel(fields: unknown): MarkerField[] {
  if (!Array.isArray(fields)) return [];
  const out: MarkerField[] = [];
  for (const field of fields as MarkerField[]) {
    if (!field || typeof field !== "object") continue;
    out.push(field);
    if (Array.isArray(field.children)) out.push(...(field.children as MarkerField[]).filter((child) => child && typeof child === "object"));
  }
  return out;
}

/** The room keys one section carries, by stable markers only. */
export function sectionRoomKeys(section: ReminderSchemaSection): Set<ReminderRoomKey> {
  const keys = new Set<ReminderRoomKey>();
  if (section.id === LAUNDRY_AREA_SECTION) keys.add("laundry");
  if (section.repeatBy === "bedrooms") keys.add("bedroom");
  if (section.repeatBy === "bathrooms") keys.add("bathroom");
  for (const field of fieldsOneLevel(section.fields)) {
    const category = typeof field.evidenceCategory === "string" ? EVIDENCE_CATEGORY_ROOM[field.evidenceCategory] : undefined;
    if (category) keys.add(category);
    if (typeof field.type === "string" && SUPPLY_FIELD_TYPES.has(field.type)) keys.add("supplies");
  }
  return keys;
}

/** Room key → the id of the first section carrying it, in form order. Rooms the form lacks are absent. */
export function firstSectionByRoom(sections: readonly ReminderSchemaSection[] | null | undefined): Map<ReminderRoomKey, string> {
  const map = new Map<ReminderRoomKey, string>();
  for (const section of sections ?? []) {
    if (!section || typeof section.id !== "string") continue;
    for (const key of Array.from(sectionRoomKeys(section))) if (!map.has(key)) map.set(key, section.id);
  }
  return map;
}
