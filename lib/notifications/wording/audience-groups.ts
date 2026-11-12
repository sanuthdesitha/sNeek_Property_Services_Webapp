/**
 * The list on "Types and wording" groups every catalog type by who receives
 * it (the approved board: Cleaners, Clients, Guests, Laundry, Office,
 * Accounts). Plain module: the screen and the tests read it.
 */
import type { NotificationTypeEntry } from "../catalog-types";

export const AUDIENCE_GROUPS = ["Cleaners", "Clients", "Guests", "Laundry", "Office", "Accounts"] as const;
export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

/** Types whose first audience would place them in the wrong group. */
const EXPLICIT: Record<string, AudienceGroup> = {
  "guest.message": "Guests",
  "laundry.supplier_chase": "Laundry",
  "laundry.team_request": "Laundry",
  "laundry.failed_pickup": "Laundry",
  "laundry.updates": "Laundry",
  "laundry.report_email": "Laundry",
  "laundry.cleaner_nudge": "Cleaners",
  "account.security": "Accounts",
  "account.invitations": "Accounts",
  "office.new_profile": "Accounts",
  "money.finance_events": "Office",
  "marketing.campaigns": "Clients",
  "leads.alerts": "Office",
  "workforce.updates": "Cleaners",
  "maintenance.assignment": "Cleaners",
  "system.provider_tests": "Office",
};

export function audienceGroup(entry: Pick<NotificationTypeEntry, "key" | "audienceKeys">): AudienceGroup {
  const explicit = EXPLICIT[entry.key];
  if (explicit) return explicit;
  const first = entry.audienceKeys[0];
  if (first === "CLIENT") return "Clients";
  if (first === "CLEANER" || first === "MAINTENANCE" || first === "QA") return "Cleaners";
  if (first === "LAUNDRY") return "Laundry";
  if (first === "PUBLIC") return "Guests";
  return "Office";
}
