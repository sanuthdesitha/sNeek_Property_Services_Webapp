import "server-only";
/**
 * Changing personal notification switches — the one write path the person's
 * own screen, an administrator's view of that person, and the older routes all
 * use. Same store both sides; last write wins, but a save that names an older
 * revision than the stored one is refused (someone changed it meanwhile).
 *
 * Every change is stamped with the ACTUAL actor (the routes refuse writes
 * while testing as someone else) and written to the audit log with the
 * switches before and after.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/settings";
import { catalogEntry } from "../catalog";
import { CLIENT_JOB_UPDATES_TYPE } from "./decide";
import {
  ALL_SWITCH_ID,
  CLIENT_CHANNEL_SWITCH_ID,
  parseSwitchId,
  sanitizeSwitchChanges,
  sanitizeSwitchValues,
  typeSwitchId,
  typesSharingEmailKind,
  type ClientJobEvent,
  type PersonalTransport,
  type SwitchChange,
  type SwitchChanges,
  type SwitchValues,
} from "./model";

export type SwitchActor = { id: string; name: string | null; role: string | null };

export type SwitchSubjectRef = { kind: "USER"; id: string } | { kind: "CLIENT"; id: string };

export type SwitchChangeInput = { id: string; on: boolean };

export class StaleSwitchesError extends Error {
  readonly status = 409;
  constructor() {
    super("These switches were changed by someone else since you opened them. Your change was not saved; the page now shows the current switches.");
  }
}

export class SwitchSubjectNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("That person or client was not found.");
  }
}

export class InvalidSwitchError extends Error {
  readonly status = 400;
  constructor(id: string) {
    super(`"${id}" is not a switch that can be changed here.`);
  }
}

function stampFor(actor: SwitchActor, now: Date): SwitchChange {
  return { byUserId: actor.id, byName: actor.name, byRole: actor.role, at: now.toISOString() };
}

/** Only a `false` is stored; switching back on removes the value (absence = allowed). */
function setValue(values: SwitchValues, id: string, on: boolean) {
  if (on) delete values[id];
  else values[id] = false;
}

const CLIENT_EVENT_COLUMN: Record<ClientJobEvent, "notifyOnEnRoute" | "notifyOnJobStart" | "notifyOnJobComplete"> = {
  enRoute: "notifyOnEnRoute",
  started: "notifyOnJobStart",
  finished: "notifyOnJobComplete",
};

type ClientColumns = {
  notificationsEnabled: boolean;
  notifyOnEnRoute: boolean;
  notifyOnJobStart: boolean;
  notifyOnJobComplete: boolean;
  preferredChannel: string;
};

/**
 * Client job updates' Email and Text cells keep the account's preferred
 * channel meaningful: switching one on adds it to the channel, switching one
 * off removes it from the channel (or, when it is the only one, stores an
 * explicit off for that cell — the channel cannot say "neither").
 */
function applyJobUpdatesChannel(columns: ClientColumns, values: SwitchValues, transport: "EMAIL" | "SMS", on: boolean) {
  const id = typeSwitchId(CLIENT_JOB_UPDATES_TYPE, transport);
  const other = transport === "EMAIL" ? "SMS" : "EMAIL";
  const channel = columns.preferredChannel === "SMS" || columns.preferredChannel === "BOTH" ? columns.preferredChannel : "EMAIL";
  const has = channel === "BOTH" || channel === transport;
  if (on) {
    delete values[id];
    if (!has) columns.preferredChannel = "BOTH";
    return;
  }
  if (channel === "BOTH") {
    columns.preferredChannel = other;
    return;
  }
  values[id] = false;
}

async function lockUserRow(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, allEmailOff: true, emailPreferences: { where: { enabled: false }, select: { key: true } } } });
  if (!user) throw new SwitchSubjectNotFoundError();
  await tx.userNotificationPreference.upsert({ where: { userId }, create: { userId, categories: {} }, update: {} });
  await tx.$queryRaw`SELECT "userId" FROM "UserNotificationPreference" WHERE "userId" = ${userId} FOR UPDATE`;
  const row = await tx.userNotificationPreference.findUniqueOrThrow({ where: { userId } });
  return { user, row };
}

function sanitizeCategories(input: unknown): Record<string, Record<string, boolean>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, Record<string, boolean>> = {};
  for (const [category, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const bucket: Record<string, boolean> = {};
    for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
      if (typeof enabled === "boolean") bucket[key] = enabled;
    }
    out[category] = bucket;
  }
  return out;
}

const TOPIC_CHANNEL_KEY: Record<PersonalTransport, "web" | "email" | "sms"> = { APP: "web", EMAIL: "email", SMS: "sms" };

type UserSnapshot = { switches: SwitchValues; allEmailOff: boolean; disabledEmailKinds: string[]; categories: Record<string, Record<string, boolean>> };

async function changeUserSwitches(tx: Prisma.TransactionClient, userId: string, actor: SwitchActor, expectedRevision: number | null, changes: SwitchChangeInput[], now: Date) {
  const { user, row } = await lockUserRow(tx, userId);
  if (expectedRevision !== null && row.switchRevision !== expectedRevision) throw new StaleSwitchesError();
  const values = sanitizeSwitchValues(row.switches);
  const stamps: SwitchChanges = sanitizeSwitchChanges(row.switchChanges);
  const categories = sanitizeCategories(row.categories);
  const disabledKinds = new Set(user.emailPreferences.map((pref) => pref.key));
  const before: UserSnapshot = { switches: { ...values }, allEmailOff: user.allEmailOff, disabledEmailKinds: Array.from(disabledKinds), categories: JSON.parse(JSON.stringify(categories)) };
  let allEmailOff = user.allEmailOff;
  const stamp = stampFor(actor, now);
  const kindsToLift = new Set<string>();

  for (const change of changes) {
    const parsed = parseSwitchId(change.id);
    if (!parsed || parsed.kind === "event") throw new InvalidSwitchError(change.id);
    if (parsed.kind === "all") setValue(values, ALL_SWITCH_ID, change.on);
    else if (parsed.kind === "transport" && parsed.transport === "EMAIL") allEmailOff = !change.on;
    else if (parsed.kind === "transport") setValue(values, change.id, change.on);
    else if (parsed.kind === "topic") {
      if (!(NOTIFICATION_CATEGORIES as string[]).includes(parsed.category)) throw new InvalidSwitchError(change.id);
      categories[parsed.category] = { ...(categories[parsed.category] ?? {}), [TOPIC_CHANNEL_KEY[parsed.transport]]: change.on };
    } else {
      setValue(values, change.id, change.on);
      const kind = catalogEntry(parsed.typeKey)?.emailKind;
      if (parsed.transport === "EMAIL" && change.on && kind && disabledKinds.has(kind)) {
        // The kind switch covers other types too: keep them off, one by one,
        // so switching THIS type back on does not switch the others on.
        for (const sibling of typesSharingEmailKind(kind)) {
          if (sibling.key === parsed.typeKey) continue;
          const siblingId = typeSwitchId(sibling.key, "EMAIL");
          values[siblingId] = false;
          stamps[siblingId] = stamp;
        }
        kindsToLift.add(kind);
      }
    }
    stamps[change.id] = stamp;
  }

  if (kindsToLift.size) await tx.userEmailPreference.deleteMany({ where: { userId, key: { in: Array.from(kindsToLift) } } });
  if (allEmailOff !== user.allEmailOff) await tx.user.update({ where: { id: userId }, data: { allEmailOff } });
  await tx.userNotificationPreference.update({
    where: { userId },
    data: { switches: values, switchChanges: stamps as Prisma.InputJsonValue, categories: categories as Prisma.InputJsonValue, switchRevision: { increment: 1 } },
  });
  const after: UserSnapshot = { switches: values, allEmailOff, disabledEmailKinds: Array.from(disabledKinds).filter((kind) => !kindsToLift.has(kind)), categories };
  await tx.auditLog.create({
    data: {
      userId: actor.id, action: "NOTIFICATION_SWITCHES_CHANGED", entity: "User", entityId: userId,
      before: before as unknown as Prisma.InputJsonValue,
      after: { ...after, changed: changes } as unknown as Prisma.InputJsonValue,
    },
  });
}

async function lockClientRow(tx: Prisma.TransactionClient, clientId: string) {
  const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new SwitchSubjectNotFoundError();
  await tx.clientNotificationPreference.upsert({ where: { clientId }, create: { clientId }, update: {} });
  await tx.$queryRaw`SELECT "clientId" FROM "ClientNotificationPreference" WHERE "clientId" = ${clientId} FOR UPDATE`;
  return tx.clientNotificationPreference.findUniqueOrThrow({ where: { clientId } });
}

async function changeClientSwitches(tx: Prisma.TransactionClient, clientId: string, actor: SwitchActor, expectedRevision: number | null, changes: SwitchChangeInput[], now: Date) {
  const row = await lockClientRow(tx, clientId);
  if (expectedRevision !== null && row.switchRevision !== expectedRevision) throw new StaleSwitchesError();
  const values = sanitizeSwitchValues(row.switches);
  const stamps: SwitchChanges = sanitizeSwitchChanges(row.switchChanges);
  const columns: ClientColumns = {
    notificationsEnabled: row.notificationsEnabled,
    notifyOnEnRoute: row.notifyOnEnRoute,
    notifyOnJobStart: row.notifyOnJobStart,
    notifyOnJobComplete: row.notifyOnJobComplete,
    preferredChannel: row.preferredChannel,
  };
  const before = { switches: { ...values }, ...columns };
  const stamp = stampFor(actor, now);

  for (const change of changes) {
    const parsed = parseSwitchId(change.id);
    if (!parsed || parsed.kind === "topic") throw new InvalidSwitchError(change.id);
    if (parsed.kind === "all") columns.notificationsEnabled = change.on;
    else if (parsed.kind === "event") columns[CLIENT_EVENT_COLUMN[parsed.event]] = change.on;
    else if (parsed.kind === "type" && parsed.typeKey === CLIENT_JOB_UPDATES_TYPE && parsed.transport !== "APP") {
      applyJobUpdatesChannel(columns, values, parsed.transport, change.on);
      stamps[CLIENT_CHANNEL_SWITCH_ID] = stamp;
    } else setValue(values, change.id, change.on);
    stamps[change.id] = stamp;
  }

  await tx.clientNotificationPreference.update({
    where: { clientId },
    data: { ...columns, switches: values, switchChanges: stamps as Prisma.InputJsonValue, switchRevision: { increment: 1 } },
  });
  await tx.auditLog.create({
    data: {
      userId: actor.id, action: "NOTIFICATION_SWITCHES_CHANGED", entity: "Client", entityId: clientId,
      before: before as unknown as Prisma.InputJsonValue,
      after: { switches: values, ...columns, changed: changes } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Apply switch changes for one person or client account. `expectedRevision`
 * null skips the stale-write check (the older routes, which never had one).
 */
export async function applySwitchChanges(input: {
  subject: SwitchSubjectRef;
  actor: SwitchActor;
  expectedRevision: number | null;
  changes: SwitchChangeInput[];
  now?: Date;
}): Promise<void> {
  if (input.changes.length === 0) return;
  const now = input.now ?? new Date();
  await db.$transaction(async (tx) => {
    if (input.subject.kind === "USER") await changeUserSwitches(tx, input.subject.id, input.actor, input.expectedRevision, input.changes, now);
    else await changeClientSwitches(tx, input.subject.id, input.actor, input.expectedRevision, input.changes, now);
  });
}

/**
 * The older routes that change a login's email switches or topic switches
 * directly (Notifications › People, email preferences) call this afterwards,
 * so the person's screen shows who changed them and a screen opened before
 * the change refuses to overwrite it.
 */
export async function recordLegacySwitchChange(userId: string, switchIds: string[], actor: SwitchActor, now = new Date()): Promise<void> {
  if (switchIds.length === 0) return;
  await db.$transaction(async (tx) => {
    await tx.userNotificationPreference.upsert({ where: { userId }, create: { userId, categories: {} }, update: {} });
    await tx.$queryRaw`SELECT "userId" FROM "UserNotificationPreference" WHERE "userId" = ${userId} FOR UPDATE`;
    const row = await tx.userNotificationPreference.findUniqueOrThrow({ where: { userId }, select: { switchChanges: true } });
    const stamps = sanitizeSwitchChanges(row.switchChanges);
    const stamp = stampFor(actor, now);
    for (const id of switchIds) stamps[id] = stamp;
    await tx.userNotificationPreference.update({ where: { userId }, data: { switchChanges: stamps as Prisma.InputJsonValue, switchRevision: { increment: 1 } } });
  });
}

export function topicIdsFor(patch: Partial<Record<NotificationCategory, Partial<Record<"web" | "email" | "sms", boolean>>>>): string[] {
  const ids: string[] = [];
  const transportOf = { web: "APP", email: "EMAIL", sms: "SMS" } as const;
  for (const [category, channels] of Object.entries(patch)) {
    for (const key of Object.keys(channels ?? {}) as Array<"web" | "email" | "sms">) ids.push(`topic:${category}:${transportOf[key]}`);
  }
  return ids;
}
