import "server-only";
/**
 * CLIENT-HANDLED MAINTENANCE: the service (rules in ./client-handling-rules).
 *
 * The office hands an item to the client; the client accepts or declines,
 * records their own tradesperson and a planned window, and marks it done or
 * "could not be done"; the office reminds (manually) and can take it back.
 *
 * Concurrency: every write takes the same per-item advisory lock as the
 * office's assign path (`maintenance-assign:<id>`), so a hand-over cannot
 * interleave with putting our worker on the item, two client-side people
 * acting at once are serialised, and "office takes it back" against "client
 * marks done" has exactly one winner; the other is refused with the reason.
 * `clientHandlingVersion` lets a stale screen be refused (409) rather than
 * overwrite a newer answer.
 *
 * Money: nothing here creates an assignment row, a pay figure, a payroll,
 * cleaner-invoice or client-invoice line, or touches the quote flow. The
 * client's tradesperson is a contact on the item; the client pays them
 * directly. Hand-over is refused while money is pending or agreed
 * (handoverBlockers).
 *
 * History: nothing is deleted. Each step writes a PropertyMaintenanceEvent
 * (the item's timeline) and an audit row; a take-back keeps the client's
 * record (response, tradesperson, outcome) on the item.
 */
import { MaintenanceStatus, Prisma, Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { resolvePhotoUrls } from "@/lib/maintenance/access";
import { syncCaseFromMaintenance } from "@/lib/cases/damage-maintenance-sync";
import { auditClientPortalAction, propertyScopeWhere, type ClientPortalContext } from "@/lib/auth/client-portal";
import { parseVaPropertyScope } from "@/lib/va/permissions";
import { FOREIGN_UPLOAD_MESSAGE, uploadKeysNotOwnedBy } from "@/lib/uploads/ownership";
import {
  CLIENT_HANDLING_ACTIVE,
  clientActionDecision,
  handoverBlockers,
  isOpenStatus,
  isWithClient,
  reminderDecision,
} from "@/lib/maintenance/client-handling-rules";
import {
  parseClientTradesperson,
  plannedWindowChanged,
  validateTradespersonInput,
  visitPlanFromTradesperson,
  type ClientTradesperson,
  type ClientTradespersonInput,
} from "@/lib/maintenance/client-tradesperson";
import {
  notifyOfficeOfClientProgress,
  resolveClientMessageTarget,
  sendClientMaintenanceMessage,
  type OfficeProgressPart,
} from "@/lib/maintenance/client-handling-notices";
import type {
  AdminClientHandlingView,
  ClientHandledItemView,
  ClientHandlingAction,
  ClientHandlingState,
  ClientMessageRecord,
  ClientMessageTransport,
  TradespersonView,
} from "@/lib/maintenance/client-handling-types";

/** A refusal with the HTTP status the route answers and a sentence for the person. */
export class ClientHandlingError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

const DEFAULT_TZ = "Australia/Sydney";
const MAX_OUTCOME_PHOTOS = 10;
const NOTE_MAX = 2000;

async function lockItem(tx: Tx, itemId: string): Promise<void> {
  // The same key as assignMaintenanceItem, so the two never interleave.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`maintenance-assign:${itemId}`}))`;
}

async function organisationTimeZone(): Promise<string> {
  const settings = await getAppSettings().catch(() => null);
  return settings?.timezone || DEFAULT_TZ;
}

function cleanText(value: string | null | undefined, max = NOTE_MAX): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function photoKeyList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string" && key.trim().length > 0) : [];
}

/** Read a stored message record; null when absent or not one. */
export function parseMessageRecord(raw: unknown): ClientMessageRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.at !== "string") return null;
  const outcomes = Array.isArray(row.outcomes) ? (row.outcomes as ClientMessageRecord["outcomes"]).filter((outcome) => outcome && typeof outcome.label === "string") : [];
  return {
    at: row.at,
    transports: Array.isArray(row.transports) ? (row.transports as ClientMessageTransport[]) : [],
    refusal: typeof row.refusal === "string" ? row.refusal : null,
    outcomes,
    taken: row.taken === true,
    ...(row.pending === true ? { pending: true } : {}),
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

const HANDLING_SELECT = {
  id: true,
  title: true,
  description: true,
  area: true,
  category: true,
  priority: true,
  status: true,
  clientVisible: true,
  propertyId: true,
  photoKeys: true,
  costApprovalStatus: true,
  quotedCost: true,
  assignedWorkerId: true,
  scheduledFor: true,
  visitPlan: true,
  clientHandling: true,
  clientHandlingVersion: true,
  clientHandedOverAt: true,
  clientHandedOverById: true,
  clientHandoverNote: true,
  clientHandoverNotice: true,
  clientRespondedAt: true,
  clientRespondedById: true,
  clientDeclineReason: true,
  clientTradesperson: true,
  clientTradespersonAt: true,
  clientTradespersonById: true,
  clientOutcomeAt: true,
  clientOutcomeById: true,
  clientOutcomeNote: true,
  clientOutcomePhotoKeys: true,
  clientReminderCount: true,
  clientLastReminderAt: true,
  clientLastReminderById: true,
  clientLastReminderKey: true,
  clientLastReminderOutcome: true,
  clientTakenBackAt: true,
  clientTakenBackById: true,
  clientTakenBackReason: true,
  assignedWorker: { select: { name: true } },
  roleAssignments: { where: { removedAt: null }, select: { role: true, user: { select: { name: true, email: true } } } },
  property: {
    select: {
      id: true,
      name: true,
      suburb: true,
      clientId: true,
      client: {
        select: {
          id: true,
          name: true,
          notificationPref: { select: { notificationsEnabled: true } },
          users: { where: { isActive: true, role: Role.CLIENT }, select: { id: true } },
          vaTeams: { where: { isActive: true }, select: { propertyIds: true, members: { where: { isActive: true, role: Role.VA }, select: { id: true } } } },
        },
      },
    },
  },
} satisfies Prisma.PropertyMaintenanceItemSelect;

type HandlingRow = Prisma.PropertyMaintenanceItemGetPayload<{ select: typeof HANDLING_SELECT }>;

async function loadRow(reader: Tx | typeof db, itemId: string, where: Prisma.PropertyMaintenanceItemWhereInput = {}): Promise<HandlingRow | null> {
  return reader.propertyMaintenanceItem.findFirst({ where: { id: itemId, ...where }, select: HANDLING_SELECT });
}

function portalPeopleCount(row: HandlingRow): number {
  const client = row.property.client;
  if (!client) return 0;
  const assistants = client.vaTeams
    .filter((team) => {
      const scope = parseVaPropertyScope(team.propertyIds);
      return !scope || scope.includes(row.property.id);
    })
    .reduce((sum, team) => sum + team.members.length, 0);
  return client.users.length + assistants;
}

function handoverInput(row: HandlingRow) {
  return {
    status: row.status,
    clientVisible: row.clientVisible,
    state: row.clientHandling as ClientHandlingState,
    hasClient: Boolean(row.property.client),
    portalPeople: portalPeopleCount(row),
    assignedWorkerName: row.assignedWorkerId ? row.assignedWorker?.name ?? "a worker" : null,
    activeRoster: row.roleAssignments.map((assignment) => ({ role: assignment.role, name: assignment.user?.name ?? assignment.user?.email ?? "Someone" })),
    costApprovalStatus: row.costApprovalStatus,
    quotedCost: row.quotedCost,
  };
}

async function nameLookup(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name ?? user.email ?? "Unnamed"]));
}

function nameOf(names: Map<string, string>, id: string | null): string {
  if (!id) return "Not recorded";
  return names.get(id) ?? "A removed account";
}

function tradespersonView(person: ClientTradesperson | null, row: HandlingRow): TradespersonView | null {
  if (!person) return null;
  return {
    name: person.name,
    phone: person.phone ?? null,
    trade: person.trade ?? null,
    company: person.company ?? null,
    note: person.note ?? null,
    plannedStart: person.plannedStart ?? null,
    plannedEnd: person.plannedEnd ?? null,
    accessMethod: person.accessMethod ?? null,
    onCleanersDay: person.visitPublished && row.visitPlan !== null,
  };
}

function responseView(row: HandlingRow, names: Map<string, string>) {
  if (!row.clientRespondedAt) return null;
  const declined = row.clientDeclineReason !== null;
  return {
    state: declined ? ("DECLINED" as const) : ("ACCEPTED" as const),
    at: row.clientRespondedAt.toISOString(),
    byName: nameOf(names, row.clientRespondedById),
    reason: row.clientDeclineReason,
  };
}

async function outcomeView(row: HandlingRow, names: Map<string, string>) {
  if (!row.clientOutcomeAt) return null;
  return {
    // An outcome is recorded only by DONE or NOT_DONE; a new hand-over clears it.
    state: row.clientHandling === "DONE" ? ("DONE" as const) : ("NOT_DONE" as const),
    at: row.clientOutcomeAt.toISOString(),
    byName: nameOf(names, row.clientOutcomeById),
    note: row.clientOutcomeNote,
    photos: await resolvePhotoUrls(row.clientOutcomePhotoKeys),
  };
}

function rowNames(row: HandlingRow): Array<string | null> {
  return [row.clientHandedOverById, row.clientRespondedById, row.clientTradespersonById, row.clientOutcomeById, row.clientLastReminderById, row.clientTakenBackById];
}

async function buildAdminView(row: HandlingRow, now: Date): Promise<AdminClientHandlingView> {
  const [names, timeZone] = await Promise.all([nameLookup(rowNames(row)), organisationTimeZone()]);
  const state = row.clientHandling as ClientHandlingState;
  const person = parseClientTradesperson(row.clientTradesperson);
  const lastMessage = parseMessageRecord(row.clientLastReminderOutcome);
  const recipients = row.property.client?.users.length ?? 0;
  const reminder = reminderDecision(
    {
      state,
      status: row.status,
      lastReminderAt: row.clientLastReminderAt,
      lastReminderTaken: lastMessage && !lastMessage.pending ? lastMessage.taken : null,
      notificationsOff: Boolean(row.property.client?.notificationPref && !row.property.client.notificationPref.notificationsEnabled),
      recipients,
      now,
    },
    (date) => formatInTimeZone(date, timeZone, "EEE d MMM HH:mm"),
  );
  return {
    itemId: row.id,
    version: row.clientHandlingVersion,
    state,
    withClient: isWithClient(state),
    status: row.status,
    clientVisible: row.clientVisible,
    clientName: row.property.client?.name ?? null,
    handedOver: row.clientHandedOverAt ? { at: row.clientHandedOverAt.toISOString(), byName: nameOf(names, row.clientHandedOverById), note: row.clientHandoverNote } : null,
    handoverMessage: parseMessageRecord(row.clientHandoverNotice),
    response: responseView(row, names),
    tradesperson: person ? { ...tradespersonView(person, row)!, updatedAt: row.clientTradespersonAt?.toISOString() ?? null, updatedByName: row.clientTradespersonById ? nameOf(names, row.clientTradespersonById) : null } : null,
    outcome: await outcomeView(row, names),
    reminders: {
      count: row.clientReminderCount,
      last: row.clientLastReminderAt ? { at: row.clientLastReminderAt.toISOString(), byName: nameOf(names, row.clientLastReminderById), message: lastMessage } : null,
      nextAllowedAt: reminder.nextAllowedAt?.toISOString() ?? null,
    },
    takenBack: row.clientTakenBackAt ? { at: row.clientTakenBackAt.toISOString(), byName: nameOf(names, row.clientTakenBackById), reason: row.clientTakenBackReason } : null,
    handoverBlockers: handoverBlockers(handoverInput(row)),
    reminderBlocker: reminder.blocker,
    recipients,
  };
}

export async function getAdminClientHandlingView(itemId: string, now: Date = new Date()): Promise<AdminClientHandlingView | null> {
  const row = await loadRow(db, itemId);
  return row ? buildAdminView(row, now) : null;
}

// ─── Office actions ─────────────────────────────────────────────────────────

/** Clears the visit written for the cleaner from the client's plan (only that one). */
function withdrawnVisit(row: HandlingRow): Prisma.PropertyMaintenanceItemUpdateInput {
  const person = parseClientTradesperson(row.clientTradesperson);
  if (!person?.visitPublished) return {};
  return {
    visitPlan: Prisma.DbNull,
    scheduledFor: null,
    clientTradesperson: { ...person, visitPublished: false } as unknown as Prisma.InputJsonValue,
  };
}

async function recordEvent(tx: Tx, row: HandlingRow, userId: string | null, note: string, toStatus?: MaintenanceStatus): Promise<void> {
  await tx.propertyMaintenanceEvent.create({
    data: { itemId: row.id, userId, fromStatus: row.status, toStatus: toStatus ?? row.status, note },
  });
}

export type OfficeActor = { userId: string; impersonatedBy: string | null };

async function officeAudit(tx: Tx, actor: OfficeActor, action: string, itemId: string, after: Record<string, unknown>): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: actor.userId,
      action,
      entity: "PropertyMaintenanceItem",
      entityId: itemId,
      after: { ...after, ...(actor.impersonatedBy ? { impersonatedBy: actor.impersonatedBy } : {}) } as Prisma.InputJsonValue,
    },
  });
}

export async function handOverToClient(input: {
  itemId: string;
  actor: OfficeActor;
  note: string | null;
  transports: ClientMessageTransport[];
  requestKey: string;
  now?: Date;
}): Promise<{ outcome: "done" | "unchanged"; view: AdminClientHandlingView }> {
  const now = input.now ?? new Date();
  const note = cleanText(input.note, 1000);
  const result = await db.$transaction(async (tx) => {
    await lockItem(tx, input.itemId);
    const row = await loadRow(tx, input.itemId);
    if (!row) throw new ClientHandlingError(404, "This item no longer exists.");
    // A repeat click lands here once the first has committed: answer as done.
    if (isWithClient(row.clientHandling) && row.clientHandedOverById === input.actor.userId) return "unchanged" as const;
    const blockers = handoverBlockers(handoverInput(row));
    if (blockers.length > 0) throw new ClientHandlingError(409, blockers.join(" "));
    await tx.propertyMaintenanceItem.update({
      where: { id: row.id },
      data: {
        clientHandling: "HANDED_OVER",
        clientHandlingVersion: { increment: 1 },
        clientHandedOverAt: now,
        clientHandedOverById: input.actor.userId,
        clientHandoverNote: note,
        clientHandoverNotice: input.transports.length > 0 ? ({ at: now.toISOString(), transports: input.transports, refusal: null, outcomes: [], taken: false, pending: true } as Prisma.InputJsonValue) : Prisma.DbNull,
        // A new round starts clean; the earlier round stays in the history.
        clientRespondedAt: null,
        clientRespondedById: null,
        clientDeclineReason: null,
        clientTradesperson: Prisma.DbNull,
        clientTradespersonAt: null,
        clientTradespersonById: null,
        clientOutcomeAt: null,
        clientOutcomeById: null,
        clientOutcomeNote: null,
        clientOutcomePhotoKeys: Prisma.DbNull,
        clientReminderCount: 0,
        clientLastReminderAt: null,
        clientLastReminderById: null,
        clientLastReminderKey: null,
        clientLastReminderOutcome: Prisma.DbNull,
        clientTakenBackAt: null,
        clientTakenBackById: null,
        clientTakenBackReason: null,
      },
    });
    await recordEvent(tx, row, input.actor.userId, note ? `Asked the client to arrange it: "${note}"` : "Asked the client to arrange it");
    await officeAudit(tx, input.actor, "MAINTENANCE_CLIENT_HANDOVER", row.id, { note, transports: input.transports, requestKey: input.requestKey });
    return "done" as const;
  });

  if (result === "done" && input.transports.length > 0) {
    const record = await sendClientMaintenanceMessage({ kind: "handover", itemId: input.itemId, actorId: input.actor.userId, transports: input.transports, requestKey: input.requestKey, note });
    await db.propertyMaintenanceItem.updateMany({
      where: { id: input.itemId, clientHandedOverAt: now },
      data: { clientHandoverNotice: record as unknown as Prisma.InputJsonValue },
    });
  }
  const view = await getAdminClientHandlingView(input.itemId, now);
  if (!view) throw new ClientHandlingError(404, "This item no longer exists.");
  return { outcome: result, view };
}

export async function remindClient(input: {
  itemId: string;
  actor: OfficeActor;
  transports: ClientMessageTransport[];
  requestKey: string;
  now?: Date;
}): Promise<{ outcome: "sent" | "replayed"; record: ClientMessageRecord | null; view: AdminClientHandlingView }> {
  const now = input.now ?? new Date();
  if (input.transports.length === 0) throw new ClientHandlingError(400, "Choose how to remind the client: portal inbox, email or both.");
  const timeZone = await organisationTimeZone();
  const claimed = await db.$transaction(async (tx) => {
    await lockItem(tx, input.itemId);
    const row = await loadRow(tx, input.itemId);
    if (!row) throw new ClientHandlingError(404, "This item no longer exists.");
    // The same request again (double click, retry): answer from the record.
    if (row.clientLastReminderKey === input.requestKey) return false;
    const last = parseMessageRecord(row.clientLastReminderOutcome);
    const decision = reminderDecision(
      {
        state: row.clientHandling as ClientHandlingState,
        status: row.status,
        lastReminderAt: row.clientLastReminderAt,
        lastReminderTaken: last && !last.pending ? last.taken : null,
        notificationsOff: Boolean(row.property.client?.notificationPref && !row.property.client.notificationPref.notificationsEnabled),
        recipients: row.property.client?.users.length ?? 0,
        now,
      },
      (date) => formatInTimeZone(date, timeZone, "EEE d MMM HH:mm"),
    );
    if (decision.blocker) throw new ClientHandlingError(409, decision.blocker);
    const count = row.clientReminderCount + 1;
    await tx.propertyMaintenanceItem.update({
      where: { id: row.id },
      data: {
        clientReminderCount: { increment: 1 },
        clientLastReminderAt: now,
        clientLastReminderById: input.actor.userId,
        clientLastReminderKey: input.requestKey,
        clientLastReminderOutcome: { at: now.toISOString(), transports: input.transports, refusal: null, outcomes: [], taken: false, pending: true } as Prisma.InputJsonValue,
      },
    });
    await recordEvent(tx, row, input.actor.userId, `Reminded the client (reminder ${count})`);
    await officeAudit(tx, input.actor, "MAINTENANCE_CLIENT_REMINDER", row.id, { count, transports: input.transports, requestKey: input.requestKey });
    return true;
  });

  let record: ClientMessageRecord | null = null;
  if (claimed) {
    record = await sendClientMaintenanceMessage({ kind: "reminder", itemId: input.itemId, actorId: input.actor.userId, transports: input.transports, requestKey: input.requestKey, note: null });
    await db.propertyMaintenanceItem.updateMany({
      where: { id: input.itemId, clientLastReminderKey: input.requestKey },
      data: { clientLastReminderOutcome: record as unknown as Prisma.InputJsonValue },
    });
  }
  const view = await getAdminClientHandlingView(input.itemId, now);
  if (!view) throw new ClientHandlingError(404, "This item no longer exists.");
  return { outcome: claimed ? "sent" : "replayed", record: record ?? view.reminders.last?.message ?? null, view };
}

export async function takeBackFromClient(input: { itemId: string; actor: OfficeActor; reason: string; now?: Date }): Promise<AdminClientHandlingView> {
  const now = input.now ?? new Date();
  const reason = cleanText(input.reason);
  if (!reason) throw new ClientHandlingError(400, "Pick a reason, or choose Other and say why.");
  await db.$transaction(async (tx) => {
    await lockItem(tx, input.itemId);
    const row = await loadRow(tx, input.itemId);
    if (!row) throw new ClientHandlingError(404, "This item no longer exists.");
    if (!isWithClient(row.clientHandling)) {
      throw new ClientHandlingError(409, row.clientHandling === "DONE" ? "The client already marked it done. Reopen the item instead." : "The item is not with the client.");
    }
    await tx.propertyMaintenanceItem.update({
      where: { id: row.id },
      data: {
        clientHandling: "TAKEN_BACK",
        clientHandlingVersion: { increment: 1 },
        clientTakenBackAt: now,
        clientTakenBackById: input.actor.userId,
        clientTakenBackReason: reason,
        ...withdrawnVisit(row),
      },
    });
    await recordEvent(tx, row, input.actor.userId, `Took it back from the client: ${reason}`);
    await officeAudit(tx, input.actor, "MAINTENANCE_CLIENT_TAKEN_BACK", row.id, { reason });
  });
  const view = await getAdminClientHandlingView(input.itemId, now);
  if (!view) throw new ClientHandlingError(404, "This item no longer exists.");
  return view;
}

// ─── Client side ────────────────────────────────────────────────────────────

/** The caller's CURRENT scope, re-read by requireClientPortal on every request. */
function clientScopeWhere(portal: Pick<ClientPortalContext, "clientId" | "propertyIds">): Prisma.PropertyMaintenanceItemWhereInput {
  return { clientVisible: true, property: propertyScopeWhere(portal), clientHandling: { not: "NONE" } };
}

async function buildClientView(row: HandlingRow): Promise<ClientHandledItemView> {
  const names = await nameLookup([row.clientRespondedById, row.clientTradespersonById, row.clientOutcomeById]);
  const state = row.clientHandling as ClientHandlingState;
  const person = parseClientTradesperson(row.clientTradesperson);
  const closed = !isOpenStatus(row.status);
  return {
    id: row.id,
    version: row.clientHandlingVersion,
    title: row.title,
    description: row.description,
    area: row.area,
    category: row.category,
    priority: row.priority,
    property: { id: row.property.id, name: row.property.name, suburb: row.property.suburb },
    photos: await resolvePhotoUrls(row.photoKeys),
    officeNote: row.clientHandoverNote,
    handedOverAt: row.clientHandedOverAt?.toISOString() ?? null,
    state,
    closed,
    canAct: isWithClient(state) && !closed,
    response: responseView(row, names),
    tradesperson: person ? { ...tradespersonView(person, row)!, updatedAt: row.clientTradespersonAt?.toISOString() ?? null, updatedByName: row.clientTradespersonById ? nameOf(names, row.clientTradespersonById) : null } : null,
    outcome: await outcomeView(row, names),
    takenBackAt: row.clientTakenBackAt?.toISOString() ?? null,
  };
}

/** Items handed to this client (current and earlier rounds), newest first. */
export async function listClientHandledItems(portal: Pick<ClientPortalContext, "clientId" | "propertyIds">): Promise<ClientHandledItemView[]> {
  const rows = await db.propertyMaintenanceItem.findMany({
    where: clientScopeWhere(portal),
    select: HANDLING_SELECT,
    orderBy: [{ clientHandedOverAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  const views = await Promise.all(rows.map(buildClientView));
  // Theirs to arrange first, then the finished record.
  return views.sort((a, b) => Number(b.canAct) - Number(a.canAct));
}

export type ClientActInput = {
  itemId: string;
  action: ClientHandlingAction;
  /** The version the person's screen showed; a newer write refuses (409). */
  expectedVersion?: number;
  reason?: string | null;
  note?: string | null;
  tradesperson?: ClientTradespersonInput;
  photoKeys?: string[];
};

type ActResult = {
  outcome: "done" | "unchanged";
  officePart: OfficeProgressPart | null;
  plannedStart: string | null;
  resolved: boolean;
  version: number;
};

function actorName(portal: ClientPortalContext): string {
  const name = portal.userName ?? "The client";
  return portal.actor === "VA" && portal.team ? `${name} (assistant, ${portal.team.name})` : name;
}

function validateOutcomePhotos(keys: readonly string[] | undefined, userId: string): string[] {
  const list = Array.from(new Set((keys ?? []).map((key) => String(key).trim()).filter(Boolean)));
  if (list.length > MAX_OUTCOME_PHOTOS) throw new ClientHandlingError(400, `Attach at most ${MAX_OUTCOME_PHOTOS} photos.`);
  if (list.some((key) => !key.startsWith("maintenance/"))) throw new ClientHandlingError(400, FOREIGN_UPLOAD_MESSAGE);
  if (uploadKeysNotOwnedBy(list, [userId]).length > 0) throw new ClientHandlingError(400, FOREIGN_UPLOAD_MESSAGE);
  return list;
}

/**
 * One client-side action. Scope and state are re-read under the item lock, so
 * an item outside the caller's current client and property scope reads as not
 * found, and the loser of a race is refused with the reason.
 */
export async function clientHandlingAct(portal: ClientPortalContext, input: ClientActInput, now: Date = new Date()): Promise<{ outcome: "done" | "unchanged"; item: ClientHandledItemView }> {
  const timeZone = await organisationTimeZone();
  // Validate what does not need the row before taking the lock.
  const reason = cleanText(input.reason);
  const note = cleanText(input.note);
  let person: ClientTradesperson | null = null;
  if (input.action === "SET_TRADESPERSON") {
    const checked = validateTradespersonInput(input.tradesperson ?? {}, timeZone, now);
    if (!checked.ok) throw new ClientHandlingError(400, checked.error);
    person = checked.value;
  }
  if ((input.action === "DECLINE" || input.action === "COULD_NOT_DO") && !reason) {
    throw new ClientHandlingError(400, "Pick a reason, or choose Other and say why.");
  }
  if (input.action === "MARK_DONE" && !note) throw new ClientHandlingError(400, "Add a short note on what was done.");
  const photoKeys = input.action === "MARK_DONE" ? validateOutcomePhotos(input.photoKeys, portal.userId) : [];

  const result: ActResult = await db.$transaction(async (tx) => {
    await lockItem(tx, input.itemId);
    const row = await loadRow(tx, input.itemId, clientScopeWhere(portal));
    if (!row) throw new ClientHandlingError(404, "This item is not available to you.");
    const state = row.clientHandling as ClientHandlingState;
    const decision = clientActionDecision(input.action, state, row.status);
    if (!decision.allowed) throw new ClientHandlingError(409, decision.reason);
    if (decision.unchanged) return { outcome: "unchanged", officePart: null, plannedStart: null, resolved: false, version: row.clientHandlingVersion };
    if (input.action !== "ACCEPT" && input.expectedVersion !== undefined && input.expectedVersion !== row.clientHandlingVersion) {
      throw new ClientHandlingError(409, "Someone else changed this item since you opened it. Your entry is kept; reload to see the latest, then save again.");
    }
    const audit = (action: string, after: Record<string, unknown>) =>
      auditClientPortalAction({ ctx: portal, action, entity: "PropertyMaintenanceItem", entityId: row.id, after }, tx);
    const version = row.clientHandlingVersion + 1;
    const accepting = state === "HANDED_OVER" ? { clientHandling: "ACCEPTED" as const, clientRespondedAt: now, clientRespondedById: portal.userId, clientDeclineReason: null } : {};

    switch (input.action) {
      case "ACCEPT": {
        await tx.propertyMaintenanceItem.update({ where: { id: row.id }, data: { ...accepting, clientHandlingVersion: { increment: 1 } } });
        await recordEvent(tx, row, portal.userId, `${actorName(portal)} accepted: they will arrange their own tradesperson`);
        await audit("maintenance.client_accept", {});
        return { outcome: "done", officePart: "accepted", plannedStart: null, resolved: false, version };
      }
      case "DECLINE": {
        await tx.propertyMaintenanceItem.update({
          where: { id: row.id },
          data: { clientHandling: "DECLINED", clientRespondedAt: now, clientRespondedById: portal.userId, clientDeclineReason: reason, clientHandlingVersion: { increment: 1 }, ...withdrawnVisit(row) },
        });
        await recordEvent(tx, row, portal.userId, `${actorName(portal)} declined to arrange it: ${reason}`);
        await audit("maintenance.client_decline", { reason });
        return { outcome: "done", officePart: "declined", plannedStart: null, resolved: false, version };
      }
      case "SET_TRADESPERSON":
      case "CLEAR_TRADESPERSON": {
        const before = parseClientTradesperson(row.clientTradesperson);
        const plan = person ? visitPlanFromTradesperson(person, row.area) : null;
        const next = person ? { ...person, visitPublished: Boolean(plan) } : null;
        // The cleaner's day reads visitPlan; write the client's plan there, or
        // withdraw only a visit that came from the client's earlier plan.
        const visit: Prisma.PropertyMaintenanceItemUpdateInput = plan
          ? { visitPlan: plan as unknown as Prisma.InputJsonValue, scheduledFor: new Date(plan.startAt) }
          : before?.visitPublished
            ? { visitPlan: Prisma.DbNull, scheduledFor: null }
            : {};
        await tx.propertyMaintenanceItem.update({
          where: { id: row.id },
          data: {
            ...accepting,
            clientTradesperson: next ? (next as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            clientTradespersonAt: now,
            clientTradespersonById: portal.userId,
            clientHandlingVersion: { increment: 1 },
            ...visit,
          },
        });
        const label = next ? `${actorName(portal)} recorded their tradesperson ${next.name}${next.plannedStart ? ` for ${formatInTimeZone(new Date(next.plannedStart), timeZone, "EEE d MMM HH:mm")}` : ""}` : `${actorName(portal)} cleared their tradesperson`;
        await recordEvent(tx, row, portal.userId, label);
        await audit(next ? "maintenance.client_tradesperson" : "maintenance.client_tradesperson_cleared", { name: next?.name ?? null, plannedStart: next?.plannedStart ?? null });
        const dateChanged = plannedWindowChanged(before, next);
        const officePart: OfficeProgressPart | null = dateChanged ? "date" : state === "HANDED_OVER" ? "accepted" : null;
        return { outcome: "done", officePart, plannedStart: next?.plannedStart ?? null, resolved: false, version };
      }
      case "MARK_DONE": {
        const tradesperson = parseClientTradesperson(row.clientTradesperson);
        const resolution = `Done by the client${tradesperson ? `'s tradesperson ${tradesperson.name}` : ""}: ${note}`;
        await tx.propertyMaintenanceItem.update({
          where: { id: row.id },
          data: {
            clientHandling: "DONE",
            clientOutcomeAt: now,
            clientOutcomeById: portal.userId,
            clientOutcomeNote: note,
            clientOutcomePhotoKeys: photoKeys.length > 0 ? photoKeys : Prisma.DbNull,
            clientHandlingVersion: { increment: 1 },
            status: MaintenanceStatus.RESOLVED,
            resolvedAt: now,
            resolvedByUserId: portal.userId,
            resolutionNote: resolution,
            // The cleaner no longer needs to expect a visit; the planned window stays in the client's record.
            ...(tradesperson?.visitPublished ? { visitPlan: Prisma.DbNull, clientTradesperson: { ...tradesperson, visitPublished: false } as unknown as Prisma.InputJsonValue } : {}),
          },
        });
        await recordEvent(tx, row, portal.userId, `${actorName(portal)} marked it done: ${note}`, MaintenanceStatus.RESOLVED);
        await audit("maintenance.client_done", { photos: photoKeys.length });
        return { outcome: "done", officePart: "done", plannedStart: null, resolved: true, version };
      }
      case "COULD_NOT_DO": {
        await tx.propertyMaintenanceItem.update({
          where: { id: row.id },
          data: { clientHandling: "NOT_DONE", clientOutcomeAt: now, clientOutcomeById: portal.userId, clientOutcomeNote: reason, clientOutcomePhotoKeys: Prisma.DbNull, clientHandlingVersion: { increment: 1 }, ...withdrawnVisit(row) },
        });
        await recordEvent(tx, row, portal.userId, `${actorName(portal)} could not get it done: ${reason}`);
        await audit("maintenance.client_not_done", { reason });
        return { outcome: "done", officePart: "not-done", plannedStart: null, resolved: false, version };
      }
    }
  });

  if (result.resolved) {
    // CP-7: carry the resolution to a linked damage case, exactly as an office
    // resolve does. After the commit and best-effort, like updateMaintenanceStatus.
    await syncCaseFromMaintenance({ itemId: input.itemId, status: MaintenanceStatus.RESOLVED });
  }
  if (result.officePart) {
    await notifyOfficeOfClientProgress({
      itemId: input.itemId,
      version: result.version,
      part: result.officePart,
      actorId: portal.userId,
      actorName: actorName(portal),
      reason,
      plannedStart: result.plannedStart,
    });
  }
  const row = await loadRow(db, input.itemId, clientScopeWhere(portal));
  if (!row) throw new ClientHandlingError(404, "This item is not available to you.");
  return { outcome: result.outcome, item: await buildClientView(row) };
}

/** For tests and the admin view: the states in which a message may reach the client. */
export const CLIENT_MESSAGE_STATES = CLIENT_HANDLING_ACTIVE;
export { resolveClientMessageTarget };
