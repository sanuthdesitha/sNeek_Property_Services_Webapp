import "server-only";
/**
 * Loads the personal switches that apply to a recipient, and answers
 * `resolvePersonalPreference` — the one resolver every send-time check and
 * every screen uses (lib/notifications/personal/decide.ts holds the rule).
 *
 * A recipient is found by account id when the sender knows it, otherwise by
 * the address the message goes to: every login with that email or phone, every
 * client account whose own email/phone it is, the client account of a client
 * login, and every client whose report or invoice delivery list names the
 * address. Any of them having switched the message off stops it.
 */
import { db } from "@/lib/db";
import { listClientDeliveryProfiles } from "@/lib/commercial/delivery-profiles";
import { decidePersonal, type ClientChannel, type ClientSubjectState, type PersonalDecision, type PersonalQuery, type PersonalSubjectState, type UserSubjectState } from "./decide";
import { sanitizeSwitchValues } from "./model";

const userSelect = {
  id: true,
  name: true,
  role: true,
  clientId: true,
  allEmailOff: true,
  emailPreferences: { where: { enabled: false }, select: { key: true } },
  notificationPreference: { select: { switches: true } },
} as const;

type UserRow = {
  id: string;
  name: string | null;
  role: string;
  clientId: string | null;
  allEmailOff: boolean;
  emailPreferences: Array<{ key: string }>;
  notificationPreference: { switches: unknown } | null;
};

const clientSelect = {
  id: true,
  name: true,
  notificationPref: {
    select: { notificationsEnabled: true, notifyOnEnRoute: true, notifyOnJobStart: true, notifyOnJobComplete: true, preferredChannel: true, switches: true },
  },
} as const;

type ClientRow = {
  id: string;
  name: string | null;
  notificationPref: {
    notificationsEnabled: boolean;
    notifyOnEnRoute: boolean;
    notifyOnJobStart: boolean;
    notifyOnJobComplete: boolean;
    preferredChannel: string;
    switches: unknown;
  } | null;
};

export function userStateFromRow(row: UserRow): UserSubjectState {
  return {
    kind: "USER",
    id: row.id,
    name: row.name,
    role: String(row.role),
    switches: sanitizeSwitchValues(row.notificationPreference?.switches),
    allEmailOff: row.allEmailOff === true,
    disabledEmailKinds: new Set(row.emailPreferences.map((item) => item.key)),
  };
}

function channelOf(value: string | null | undefined): ClientChannel {
  return value === "SMS" || value === "BOTH" ? value : "EMAIL";
}

/** A client with no preference row has every switch on and email as its job-update channel (the defaults). */
export function clientStateFromRow(row: ClientRow): ClientSubjectState {
  const pref = row.notificationPref;
  return {
    kind: "CLIENT",
    id: row.id,
    name: row.name,
    notificationsEnabled: pref?.notificationsEnabled !== false,
    events: {
      enRoute: pref?.notifyOnEnRoute !== false,
      started: pref?.notifyOnJobStart !== false,
      finished: pref?.notifyOnJobComplete !== false,
    },
    preferredChannel: channelOf(pref?.preferredChannel),
    switches: sanitizeSwitchValues(pref?.switches),
  };
}

export async function loadClientSubject(clientId: string): Promise<ClientSubjectState | null> {
  const row = await db.client.findUnique({ where: { id: clientId }, select: clientSelect });
  return row ? clientStateFromRow(row as ClientRow) : null;
}

/** A login, plus its client account when it is a client login. */
export async function loadUserSubjects(userId: string): Promise<PersonalSubjectState[]> {
  const row = (await db.user.findUnique({ where: { id: userId }, select: userSelect })) as UserRow | null;
  if (!row) return [];
  const states: PersonalSubjectState[] = [userStateFromRow(row)];
  if (String(row.role) === "CLIENT" && row.clientId) {
    const client = await loadClientSubject(row.clientId);
    if (client) states.push(client);
  }
  return states;
}

/** The forms a stored phone number may take for one number (04…, +614…, 614…). */
export function phoneVariants(raw: string): string[] {
  const trimmed = String(raw ?? "").trim();
  const compact = trimmed.replace(/[\s()-]/g, "");
  const variants = new Set<string>([trimmed, compact]);
  let national: string | null = null;
  if (/^04\d{8}$/.test(compact)) national = compact;
  else if (/^\+614\d{8}$/.test(compact)) national = `0${compact.slice(3)}`;
  else if (/^614\d{8}$/.test(compact)) national = `0${compact.slice(2)}`;
  if (national) {
    variants.add(national);
    variants.add(`+61${national.slice(1)}`);
    variants.add(`61${national.slice(1)}`);
    variants.add(`${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`);
  }
  return Array.from(variants).filter(Boolean);
}

async function clientIdsFromDeliveryLists(address: string): Promise<string[]> {
  const wanted = address.trim().toLowerCase();
  const profiles = await listClientDeliveryProfiles();
  return profiles
    .filter((profile) => [...profile.reportRecipients, ...profile.invoiceRecipients].some((email) => email.trim().toLowerCase() === wanted))
    .map((profile) => profile.clientId);
}

async function subjectsForAddress(transport: "EMAIL" | "SMS", address: string): Promise<PersonalSubjectState[]> {
  const value = address.trim();
  if (!value) return [];
  const userWhere = transport === "EMAIL"
    ? { email: { equals: value, mode: "insensitive" as const } }
    : { phone: { in: phoneVariants(value) } };
  const clientWhere = transport === "EMAIL"
    ? { email: { equals: value, mode: "insensitive" as const } }
    : { phone: { in: phoneVariants(value) } };
  const [users, clients, listed] = await Promise.all([
    db.user.findMany({ where: userWhere, select: userSelect, take: 20 }) as Promise<UserRow[]>,
    db.client.findMany({ where: clientWhere, select: clientSelect, take: 20 }) as Promise<ClientRow[]>,
    transport === "EMAIL" ? clientIdsFromDeliveryLists(value) : Promise.resolve([] as string[]),
  ]);
  const states: PersonalSubjectState[] = users.map(userStateFromRow);
  const clientIds = new Set<string>(clients.map((client) => client.id));
  const extraClientIds = [
    ...users.filter((user) => String(user.role) === "CLIENT" && user.clientId).map((user) => user.clientId as string),
    ...listed,
  ].filter((id) => !clientIds.has(id));
  const extraClients = extraClientIds.length
    ? ((await db.client.findMany({ where: { id: { in: Array.from(new Set(extraClientIds)) } }, select: clientSelect })) as ClientRow[])
    : [];
  for (const client of [...clients, ...extraClients]) states.push(clientStateFromRow(client));
  return states;
}

export type RecipientRef = {
  transport: "EMAIL" | "SMS" | "APP";
  /** The account the message is for, when the sender knows it. */
  userId?: string | null;
  /** The email address or phone number it goes to (EMAIL / SMS). */
  address?: string | null;
};

/** Every subject whose switches apply to this recipient. */
export async function subjectsForRecipient(ref: RecipientRef): Promise<PersonalSubjectState[]> {
  if (ref.userId) return loadUserSubjects(ref.userId);
  if (ref.transport !== "APP" && ref.address) return subjectsForAddress(ref.transport, ref.address);
  return [];
}

/**
 * THE resolver: may this message reach this recipient on this transport, as
 * far as personal switches go? Office-level switches (type controls, audience
 * controls, email kinds) are checked by their own chokepoints, above this.
 */
export async function resolvePersonalPreference(ref: RecipientRef, query: PersonalQuery): Promise<PersonalDecision> {
  const states = await subjectsForRecipient(ref);
  return decidePersonal(states, query);
}
