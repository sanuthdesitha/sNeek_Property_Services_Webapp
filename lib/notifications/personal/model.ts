/**
 * Personal notification switches: the one two-way preference model every
 * portal shares (2026-11-21). The person and an administrator look at, and
 * change, exactly the same switches in the same stores.
 *
 * Dependency-free apart from the catalog (data only), so the screens, the
 * routes, the send-time check and the static tests can all import it.
 *
 * Stores (no sixth competing one):
 * - UserNotificationPreference.switches / switchChanges / switchRevision: a
 *   login's own switches ("all", "transport:APP|SMS", "type:<key>:<transport>").
 * - User.allEmailOff: that login's "all email" switch ("transport:EMAIL").
 * - UserEmailPreference: per automatic-email kind (a type's Email switch shows
 *   it; switching the type back on lifts it without lifting other types).
 * - UserNotificationPreference.categories: the older per-topic switches,
 *   still enforced where they always were (shown as "Topics").
 * - ClientNotificationPreference: a client account's switches. Its
 *   notificationsEnabled is the account's "all" switch; the three event
 *   switches and the preferred channel keep their meaning for job updates.
 *   They apply to every client login and to the client's own address/phone.
 *
 * Only an explicit `false` blocks. A missing value means allowed, so a new
 * notification type arrives allowed and nobody silently stops receiving.
 */
import { NOTIFICATION_CATALOG, catalogEntry } from "../catalog";
import type { CatalogGroup, NotificationTransport, NotificationTypeEntry } from "../catalog-types";
import type { NotificationAudience } from "../audience-controls";

export const PERSONAL_TRANSPORTS = ["APP", "EMAIL", "SMS"] as const;
export type PersonalTransport = (typeof PERSONAL_TRANSPORTS)[number];

export const PERSONAL_TRANSPORT_LABEL: Record<PersonalTransport, string> = {
  APP: "In the app",
  EMAIL: "Email",
  SMS: "Text",
};

/** Inbox, phone push and browser push are one personal choice: "In the app". */
export function personalTransportOf(transport: NotificationTransport): PersonalTransport {
  if (transport === "EMAIL") return "EMAIL";
  if (transport === "SMS") return "SMS";
  return "APP";
}

export const ALL_SWITCH_ID = "all";

export function transportSwitchId(transport: PersonalTransport): string {
  return `transport:${transport}`;
}

export function typeSwitchId(typeKey: string, transport: PersonalTransport): string {
  return `type:${typeKey}:${transport}`;
}

/** The three job-update events a client account has always been able to switch. */
export const CLIENT_JOB_EVENTS = ["enRoute", "started", "finished"] as const;
export type ClientJobEvent = (typeof CLIENT_JOB_EVENTS)[number];

export const CLIENT_JOB_EVENT_LABEL: Record<ClientJobEvent, string> = {
  enRoute: "Cleaner on the way",
  started: "Clean started",
  finished: "Clean finished, report ready",
};

export function clientEventSwitchId(event: ClientJobEvent): string {
  return `event:${event}`;
}

/** The job-updates channel choice a client account has always had. */
export const CLIENT_CHANNEL_SWITCH_ID = "channel";

/** Per-topic switches (UserNotificationPreference.categories). */
export function topicSwitchId(category: string, transport: PersonalTransport): string {
  return `topic:${category}:${transport}`;
}

export type ParsedSwitchId =
  | { kind: "all" }
  | { kind: "transport"; transport: PersonalTransport }
  | { kind: "type"; typeKey: string; transport: PersonalTransport }
  | { kind: "event"; event: ClientJobEvent }
  | { kind: "topic"; category: string; transport: PersonalTransport };

function isPersonalTransport(value: string): value is PersonalTransport {
  return (PERSONAL_TRANSPORTS as readonly string[]).includes(value);
}

/** Null for anything that is not a well-formed switch id. */
export function parseSwitchId(id: string): ParsedSwitchId | null {
  if (id === ALL_SWITCH_ID) return { kind: "all" };
  const parts = id.split(":");
  if (parts[0] === "transport" && parts.length === 2 && isPersonalTransport(parts[1])) return { kind: "transport", transport: parts[1] };
  if (parts[0] === "event" && parts.length === 2 && (CLIENT_JOB_EVENTS as readonly string[]).includes(parts[1])) {
    return { kind: "event", event: parts[1] as ClientJobEvent };
  }
  if (parts[0] === "topic" && parts.length === 3 && isPersonalTransport(parts[2])) return { kind: "topic", category: parts[1], transport: parts[2] };
  if (parts[0] === "type" && parts.length >= 3) {
    const transport = parts[parts.length - 1];
    const typeKey = parts.slice(1, -1).join(":");
    if (isPersonalTransport(transport) && catalogEntry(typeKey)) return { kind: "type", typeKey, transport };
  }
  return null;
}

/**
 * Always sent, whatever any personal switch says: sign-in and security
 * messages (or a person could lock themselves out), and the sending
 * safeguards' own alert to administrators.
 */
export const ALWAYS_SENT_TYPES: ReadonlySet<string> = new Set([
  "account.security",
  "account.invitations",
  "account.backup_code_used",
  "account.tested_as",
  "system.sending_safeguard",
]);

/** Test sends an administrator makes to themselves: not a notification anyone receives. */
const NOT_LISTED_TYPES: ReadonlySet<string> = new Set(["system.provider_tests"]);

/** Why a type has no personal switch, in plain words. Null when the person can switch it. */
export type FixedReason = "SECURITY" | "OFFICE_NEEDS" | "OFFICE_DECISION";

export const FIXED_REASON_TEXT: Record<FixedReason, string> = {
  SECURITY: "Always sent: sign-in and security messages.",
  OFFICE_NEEDS: "Always sent: the office needs to reach you about this.",
  OFFICE_DECISION: "Sent only when someone in the office chooses to send it.",
};

/**
 * Whether personal switches apply to a type.
 * - Security types: never (always sent).
 * - IGNORES types: operational messages the office must be able to send.
 * - ADMIN_SWITCH types: office-directed; personal switches apply only when an
 *   administrator turned "respects preferences" on for the type.
 */
export function fixedReasonFor(entry: NotificationTypeEntry, respectsPreferencesNow: boolean): FixedReason | null {
  if (ALWAYS_SENT_TYPES.has(entry.key)) return "SECURITY";
  if (entry.preferences === "IGNORES") return "OFFICE_NEEDS";
  if (entry.preferences === "ADMIN_SWITCH" && !respectsPreferencesNow) return "OFFICE_DECISION";
  return null;
}

/** Plain-word groups for a client account. Anything unlisted falls back to the catalog group. */
const CLIENT_GROUP_OF: Record<string, string> = {
  "client.job_updates": "Your cleans",
  "client.lifecycle_email": "Your cleans",
  "job.reminder.scheduled": "Your cleans",
  "client.delay_notice": "Your cleans",
  "client.post_job": "Reports and follow-ups",
  "client.documents": "Reports, quotes and invoices",
  "client.approvals": "Approvals and requests",
  "office.cases": "Repairs and damage",
  "client.damage_released": "Repairs and damage",
  "client.maintenance_handover": "Repairs and damage",
  "client.maintenance_reminder": "Repairs and damage",
  "lostfound.client_notice": "Lost and found",
  "lostfound.client_return_request": "Lost and found",
  "stock.shopping_and_orders": "Supplies and shopping",
  "money.finance_events": "Bills and payments",
  "client.office_messages": "Messages",
  "marketing.campaigns": "Offers and news",
  "office.new_profile": "Your account",
  "onboarding.client_link": "Your account",
  "checklist.amenities_link": "Your account",
  "account.security": "Your account",
  "account.invitations": "Your account",
  "account.backup_code_used": "Your account",
  "account.tested_as": "Your account",
};

export const CLIENT_GROUP_ORDER = [
  "Your cleans",
  "Reports and follow-ups",
  "Reports, quotes and invoices",
  "Approvals and requests",
  "Repairs and damage",
  "Lost and found",
  "Supplies and shopping",
  "Bills and payments",
  "Messages",
  "Offers and news",
  "Your account",
];

const STAFF_GROUP_LABEL: Partial<Record<CatalogGroup, string>> = {
  Jobs: "Jobs",
  Cleaners: "Your work",
  Clients: "Clients",
  "Office alerts": "Office alerts",
  Laundry: "Laundry",
  Stock: "Supplies and stock",
  Money: "Money",
  Accounts: "Your account",
  Workforce: "Team and learning",
  "Leads & marketing": "Leads and marketing",
};

export function personalGroupFor(entry: NotificationTypeEntry, audience: NotificationAudience): string {
  if (audience === "CLIENT") return CLIENT_GROUP_OF[entry.key] ?? STAFF_GROUP_LABEL[entry.group] ?? entry.group;
  return STAFF_GROUP_LABEL[entry.group] ?? entry.group;
}

export function personalGroupOrder(audience: NotificationAudience): string[] {
  if (audience === "CLIENT") return CLIENT_GROUP_ORDER;
  return Object.values(STAFF_GROUP_LABEL) as string[];
}

/** The personal transports a type can actually use, in display order. */
export function personalTransportsOfType(entry: NotificationTypeEntry): PersonalTransport[] {
  const used = new Set(entry.transports.map(personalTransportOf));
  return PERSONAL_TRANSPORTS.filter((transport) => used.has(transport));
}

/**
 * Every notification type that can reach this audience, from the catalog.
 * Types no code sends today and the administrator's own test sends are left
 * out (nothing to switch).
 */
export function personalTypesFor(audience: NotificationAudience): NotificationTypeEntry[] {
  return NOTIFICATION_CATALOG.filter((entry) =>
    entry.audienceKeys.includes(audience) && entry.path !== "NO_PRODUCER" && !NOT_LISTED_TYPES.has(entry.key),
  );
}

/** The audience a portal account is listed under (a VA works in the client portal). */
export function listingAudienceForRole(role: string | null | undefined): NotificationAudience {
  switch (role) {
    case "CLIENT":
    case "VA":
      return "CLIENT";
    case "CLEANER":
      return "CLEANER";
    case "LAUNDRY":
      return "LAUNDRY";
    case "MAINTENANCE":
      return "MAINTENANCE";
    case "QA_INSPECTOR":
      return "QA";
    case "ADMIN":
    case "OPS_MANAGER":
      return "STAFF_ADMIN";
    default:
      return "PUBLIC";
  }
}

/** Catalog types whose Email switch is governed by the same automatic-email kind. */
export function typesSharingEmailKind(kind: string): NotificationTypeEntry[] {
  return NOTIFICATION_CATALOG.filter((entry) => entry.emailKind === kind);
}

/** What is recorded for a message the recipient's own switches stopped. Never "sent". */
export const PERSONAL_SKIP_TEXT = {
  CLIENT: "Not sent: this client has switched these notifications off.",
  PERSON: "Not sent: this person has switched these notifications off.",
} as const;

export function isPersonalSkipError(text: string | null | undefined): boolean {
  return text === PERSONAL_SKIP_TEXT.CLIENT || text === PERSONAL_SKIP_TEXT.PERSON;
}

/** Who changed a switch, and when (ISO). Kept beside the switch values. */
export type SwitchChange = {
  byUserId: string;
  byName: string | null;
  byRole: string | null;
  at: string;
};

export type SwitchValues = Record<string, boolean>;
export type SwitchChanges = Record<string, SwitchChange>;

/** Keeps only well-formed switch ids with boolean values; anything else is dropped. */
export function sanitizeSwitchValues(input: unknown): SwitchValues {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: SwitchValues = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "boolean") continue;
    const parsed = parseSwitchId(id);
    if (parsed && (parsed.kind === "all" || parsed.kind === "transport" || parsed.kind === "type")) out[id] = value;
  }
  return out;
}

export function sanitizeSwitchChanges(input: unknown): SwitchChanges {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: SwitchChanges = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (typeof row.byUserId !== "string" || typeof row.at !== "string") continue;
    out[id.slice(0, 200)] = {
      byUserId: row.byUserId,
      byName: typeof row.byName === "string" ? row.byName : null,
      byRole: typeof row.byRole === "string" ? row.byRole : null,
      at: row.at,
    };
  }
  return out;
}
