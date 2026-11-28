import "server-only";
/**
 * The seams where pilot features choose between the new and the previous
 * behaviour. Each helper returns what the previous code path expects when
 * the pilot is off, so the old path runs unchanged.
 */
import type { PropertyReminderSource } from "@/lib/properties/property-reminders";
import { pilotApplies, type PilotState, type PilotSubject } from "./registry";
import { isPilotOn, loadPilotState } from "./state";

/**
 * "Property reminders": the property (with its features) for the start
 * briefing when the pilot is on for this cleaner / property, else null —
 * which gives exactly the briefing list from before the pilot.
 */
export async function reminderSource<T extends PropertyReminderSource>(property: T, subject: PilotSubject): Promise<T | null> {
  return (await isPilotOn("property-reminders", subject)) ? property : null;
}

/** The same choice for several people at once (the office's briefing proof), from one state read. */
export async function reminderSourceByUser<T extends PropertyReminderSource>(
  property: T,
  propertyId: string | null,
): Promise<(userId: string | null) => T | null> {
  const state: PilotState = await loadPilotState();
  return (userId) => (pilotApplies(state, "property-reminders", { userId, propertyId }) ? property : null);
}

/** "Looks unused — ask the office" offered and accepted for this cleaner / property. */
export async function unusedCheckEnabled(subject: PilotSubject): Promise<boolean> {
  return isPilotOn("unused-check", subject);
}
