import "server-only";
/**
 * Builds the personal notification screen for one person or client account:
 * every type that can reach them, per transport, with the office-level
 * switches shown above the personal ones ("Switched off by the office"), what
 * cannot reach them at all (no email, no mobile), and who last changed each
 * switch. The person's screen and the administrator's view use this alone.
 */
import { db } from "@/lib/db";
import { getAppSettings, NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_META, type AppSettings, type NotificationCategory } from "@/lib/settings";
import { NOTIFICATION_AUDIENCES, isChannelAllowed, type NotificationAudience } from "../audience-controls";
import { isAudienceKindAllowed, isAutoEmailAllowed, type EmailAutoKind } from "../email-kinds";
import { getNotificationTypeControls, isTransportSwitchedOff, typeRespectsPreferences, type NotificationTypeControls } from "../type-controls";
import type { NotificationTypeEntry } from "../catalog-types";
import { CLIENT_JOB_UPDATES_TYPE, type ClientSubjectState, type UserSubjectState } from "./decide";
import {
  ALL_SWITCH_ID,
  CLIENT_CHANNEL_SWITCH_ID,
  CLIENT_JOB_EVENTS,
  CLIENT_JOB_EVENT_LABEL,
  FIXED_REASON_TEXT,
  PERSONAL_TRANSPORTS,
  PERSONAL_TRANSPORT_LABEL,
  clientEventSwitchId,
  fixedReasonFor,
  listingAudienceForRole,
  personalGroupFor,
  personalGroupOrder,
  personalTransportOf,
  personalTransportsOfType,
  personalTypesFor,
  sanitizeSwitchChanges,
  topicSwitchId,
  transportSwitchId,
  typeSwitchId,
  type PersonalTransport,
  type SwitchChanges,
} from "./model";
import { clientStateFromRow, userStateFromRow } from "./resolve";
import type { GroupView, PersonalSwitchesView, SwitchCell, SwitchStamp, TopicView, TypeRowView } from "./view-types";

type Context = {
  audience: NotificationAudience;
  settings: AppSettings;
  controls: NotificationTypeControls;
  stamps: SwitchChanges;
  hasEmail: boolean;
  hasPhone: boolean;
  canEdit: boolean;
};

const AUDIENCE_LABEL = Object.fromEntries(NOTIFICATION_AUDIENCES.map((item) => [item.key, item.label])) as Record<NotificationAudience, string>;

const CHANNEL_OF: Record<PersonalTransport, "push" | "email" | "sms"> = { APP: "push", EMAIL: "email", SMS: "sms" };

function stampOf(stamps: SwitchChanges, ...ids: string[]): SwitchStamp | null {
  const found = ids.map((id) => stamps[id]).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))[0];
  return found ? { byName: found.byName, byRole: found.byRole, at: found.at } : null;
}

/** The office-level reason a whole transport cannot reach this audience, if any. */
function transportOfficeOff(transport: PersonalTransport, ctx: Context): string | null {
  if (transport === "SMS" && ctx.settings.smsProvider === "none") return "Switched off by the office: text messages are not sent at all.";
  if (!isChannelAllowed(ctx.settings.notificationAudienceControls, ctx.audience, CHANNEL_OF[transport])) {
    return `Switched off by the office: ${PERSONAL_TRANSPORT_LABEL[transport].toLowerCase()} for ${AUDIENCE_LABEL[ctx.audience].toLowerCase()}.`;
  }
  return null;
}

function scheduledOff(entry: NotificationTypeEntry, settings: AppSettings): boolean {
  const scheduled = entry.switches.flatMap((item) => (item.kind === "SCHEDULED" ? [item.setting] : []));
  return scheduled.length > 0 && scheduled.every((setting) => settings.scheduledNotifications?.[setting] !== true);
}

/** Office-level switches that stop this type on this transport for this audience. */
function typeOfficeOff(entry: NotificationTypeEntry, transport: PersonalTransport, ctx: Context): string | null {
  if (scheduledOff(entry, ctx.settings)) return "Switched off by the office.";
  const own = entry.transports.filter((item) => personalTransportOf(item) === transport);
  if (own.length > 0 && own.every((item) => isTransportSwitchedOff(ctx.controls, entry.key, item))) return "Switched off by the office.";
  const whole = transportOfficeOff(transport, ctx);
  if (whole) return whole;
  if (transport === "EMAIL" && entry.emailKind) {
    const kind = entry.emailKind as EmailAutoKind;
    if (!isAutoEmailAllowed(ctx.settings.emailAutomation, kind)) return "Switched off by the office: this automatic email is off.";
    if (!isAudienceKindAllowed(ctx.settings.emailAutomation, ctx.audience, kind)) return `Switched off by the office for ${AUDIENCE_LABEL[ctx.audience].toLowerCase()}.`;
  }
  return null;
}

function unavailableFor(transport: PersonalTransport | null, ctx: Context): string | null {
  if (transport === "EMAIL" && !ctx.hasEmail) return "No email address on file.";
  if (transport === "SMS" && !ctx.hasPhone) return "No mobile number on file.";
  return null;
}

function cell(ctx: Context, input: { id: string; transport: PersonalTransport | null; label: string; on: boolean; editable?: boolean; officeOff?: string | null; coveredBy?: string | null; stampIds?: string[] }): SwitchCell {
  return {
    id: input.id,
    transport: input.transport,
    label: input.label,
    on: input.on,
    editable: ctx.canEdit && input.editable !== false,
    officeOff: input.officeOff ?? null,
    unavailable: unavailableFor(input.transport, ctx),
    coveredBy: input.coveredBy ?? null,
    changed: stampOf(ctx.stamps, input.id, ...(input.stampIds ?? [])),
  };
}

type PersonalReader = {
  master: boolean;
  transportOn: (transport: PersonalTransport) => boolean;
  typeOn: (entry: NotificationTypeEntry, transport: PersonalTransport) => boolean;
};

function userReader(state: UserSubjectState): PersonalReader {
  return {
    master: state.switches[ALL_SWITCH_ID] !== false,
    transportOn: (transport) => (transport === "EMAIL" ? !state.allEmailOff : state.switches[transportSwitchId(transport)] !== false),
    typeOn: (entry, transport) => {
      if (state.switches[typeSwitchId(entry.key, transport)] === false) return false;
      return !(transport === "EMAIL" && entry.emailKind && state.disabledEmailKinds.has(entry.emailKind));
    },
  };
}

function clientReader(state: ClientSubjectState): PersonalReader {
  return {
    master: state.notificationsEnabled,
    transportOn: (transport) => state.switches[transportSwitchId(transport)] !== false,
    typeOn: (entry, transport) => {
      if (state.switches[typeSwitchId(entry.key, transport)] === false) return false;
      if (entry.key !== CLIENT_JOB_UPDATES_TYPE) return true;
      if (transport === "EMAIL") return state.preferredChannel !== "SMS";
      if (transport === "SMS") return state.preferredChannel !== "EMAIL";
      return true;
    },
  };
}

function coveredByFor(reader: PersonalReader, transport: PersonalTransport): string | null {
  if (!reader.master) return "All notifications are switched off.";
  if (!reader.transportOn(transport)) return `All ${PERSONAL_TRANSPORT_LABEL[transport].toLowerCase()} is switched off.`;
  return null;
}

function buildGroups(ctx: Context, reader: PersonalReader): GroupView[] {
  const groups = new Map<string, TypeRowView[]>();
  for (const entry of personalTypesFor(ctx.audience)) {
    const fixed = fixedReasonFor(entry, typeRespectsPreferences(ctx.controls, entry.key));
    const cells = personalTransportsOfType(entry).map((transport) => {
      const id = typeSwitchId(entry.key, transport);
      const jobUpdatesChannel = entry.key === CLIENT_JOB_UPDATES_TYPE && transport !== "APP" ? [CLIENT_CHANNEL_SWITCH_ID] : [];
      return cell(ctx, {
        id, transport, label: PERSONAL_TRANSPORT_LABEL[transport],
        on: fixed ? true : reader.typeOn(entry, transport),
        editable: !fixed,
        officeOff: typeOfficeOff(entry, transport, ctx),
        coveredBy: fixed ? null : coveredByFor(reader, transport),
        stampIds: jobUpdatesChannel,
      });
    });
    const row: TypeRowView = {
      key: entry.key,
      name: entry.name,
      trigger: entry.trigger,
      fixed,
      fixedText: fixed ? FIXED_REASON_TEXT[fixed] : null,
      officeNote: !fixed && entry.initiator === "OFFICE_MANUAL" ? "When someone in the office sends this by hand, it still goes." : null,
      cells,
    };
    const label = personalGroupFor(entry, ctx.audience);
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  const order = personalGroupOrder(ctx.audience);
  return Array.from(groups.entries())
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    .map(([label, rows]) => ({ label, rows }));
}

function buildMasterAndTransports(ctx: Context, reader: PersonalReader) {
  const master = cell(ctx, { id: ALL_SWITCH_ID, transport: null, label: "All notifications", on: reader.master });
  const transports = PERSONAL_TRANSPORTS.map((transport) =>
    cell(ctx, {
      id: transportSwitchId(transport), transport, label: `All ${PERSONAL_TRANSPORT_LABEL[transport].toLowerCase()}`,
      on: reader.transportOn(transport), officeOff: transportOfficeOff(transport, ctx),
      coveredBy: reader.master ? null : "All notifications are switched off.",
    }),
  );
  return { master, transports };
}

const CLIENT_TOPICS_HIDDEN: ReadonlySet<NotificationCategory> = new Set<NotificationCategory>(["laundry", "ical"]);

function buildTopics(ctx: Context, categories: Record<NotificationCategory, { web: boolean; email: boolean; sms: boolean }>): TopicView[] {
  const key = { APP: "web", EMAIL: "email", SMS: "sms" } as const;
  return NOTIFICATION_CATEGORIES.filter((category) => !(ctx.audience === "CLIENT" && CLIENT_TOPICS_HIDDEN.has(category))).map((category) => ({
    category,
    label: NOTIFICATION_CATEGORY_META[category].label,
    description: NOTIFICATION_CATEGORY_META[category].description,
    cells: PERSONAL_TRANSPORTS.map((transport) =>
      cell(ctx, { id: topicSwitchId(category, transport), transport, label: PERSONAL_TRANSPORT_LABEL[transport], on: categories[category][key[transport]], officeOff: transportOfficeOff(transport, ctx) }),
    ),
  }));
}

function countOff(view: Pick<PersonalSwitchesView, "master" | "transports" | "jobEvents" | "groups" | "topics">): number {
  const cells = [view.master, ...view.transports, ...(view.jobEvents ?? []), ...view.groups.flatMap((group) => group.rows.flatMap((row) => (row.fixed ? [] : row.cells)))];
  return cells.filter((item) => !item.on).length + (view.topics ?? []).flatMap((topic) => topic.cells).filter((item) => !item.on && item.transport !== "SMS").length;
}

export type ViewAccess = { canEdit: boolean; readOnlyReason: string | null };

async function baseContext(audience: NotificationAudience, stamps: SwitchChanges, hasEmail: boolean, hasPhone: boolean, access: ViewAccess): Promise<Context> {
  const [settings, controls] = await Promise.all([getAppSettings(), getNotificationTypeControls()]);
  return { audience, settings, controls, stamps, hasEmail, hasPhone, canEdit: access.canEdit };
}

/** Quick count of a login's personal "off" choices (lists; not the full screen). */
export function userOffCount(state: UserSubjectState): number {
  return Object.values(state.switches).filter((value) => value === false).length + (state.allEmailOff ? 1 : 0) + state.disabledEmailKinds.size;
}

export function clientOffCount(state: ClientSubjectState): number {
  const events = CLIENT_JOB_EVENTS.filter((event) => !state.events[event]).length;
  return Object.values(state.switches).filter((value) => value === false).length + (state.notificationsEnabled ? 0 : 1) + events;
}

export async function buildUserSwitchesView(userId: string, access: ViewAccess): Promise<PersonalSwitchesView | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, role: true, clientId: true, email: true, phone: true, allEmailOff: true,
      emailPreferences: { where: { enabled: false }, select: { key: true } },
      notificationPreference: { select: { switches: true, switchChanges: true, switchRevision: true, categories: true } },
    },
  });
  if (!row) return null;
  const state = userStateFromRow(row as never);
  const audience = listingAudienceForRole(String(row.role));
  const stamps = sanitizeSwitchChanges(row.notificationPreference?.switchChanges);
  const ctx = await baseContext(audience, stamps, Boolean(row.email?.trim()), Boolean(row.phone?.trim()), access);
  const reader = userReader(state);
  const { getUserNotificationPreferences } = await import("../preferences");
  const categories = await getUserNotificationPreferences(userId);
  const { master, transports } = buildMasterAndTransports(ctx, reader);
  const groups = buildGroups(ctx, reader);
  const topics = buildTopics(ctx, categories);
  let account: PersonalSwitchesView["account"] = null;
  if (String(row.role) === "CLIENT" && row.clientId) {
    const client = await db.client.findUnique({ where: { id: row.clientId }, select: { id: true, name: true, notificationPref: true } });
    if (client) {
      const clientState = clientStateFromRow(client as never);
      account = { clientId: client.id, name: client.name, allOff: !clientState.notificationsEnabled, offCount: clientOffCount(clientState) };
    }
  }
  const partial = { master, transports, jobEvents: null, groups, topics };
  return {
    subject: { kind: "USER", id: row.id, name: row.name, role: String(row.role), hasEmail: ctx.hasEmail, hasPhone: ctx.hasPhone },
    revision: row.notificationPreference?.switchRevision ?? 0,
    timeZone: ctx.settings.timezone || "Australia/Sydney",
    ...partial,
    account,
    logins: null,
    offCount: countOff(partial),
    canEdit: access.canEdit,
    readOnlyReason: access.readOnlyReason,
  };
}

export async function buildClientSwitchesView(clientId: string, access: ViewAccess): Promise<PersonalSwitchesView | null> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      id: true, name: true, email: true, phone: true,
      notificationPref: true,
      users: {
        where: { role: "CLIENT" },
        select: { id: true, name: true, email: true, phone: true, role: true, clientId: true, allEmailOff: true, emailPreferences: { where: { enabled: false }, select: { key: true } }, notificationPreference: { select: { switches: true } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!client) return null;
  const state = clientStateFromRow(client as never);
  const stamps = sanitizeSwitchChanges(client.notificationPref?.switchChanges);
  const hasEmail = Boolean(client.email?.trim()) || client.users.some((user) => Boolean(user.email?.trim()));
  const hasPhone = Boolean(client.phone?.trim()) || client.users.some((user) => Boolean(user.phone?.trim()));
  const ctx = await baseContext("CLIENT", stamps, hasEmail, hasPhone, access);
  const reader = clientReader(state);
  const { master, transports } = buildMasterAndTransports(ctx, reader);
  const jobEvents = CLIENT_JOB_EVENTS.map((event) =>
    cell(ctx, { id: clientEventSwitchId(event), transport: null, label: CLIENT_JOB_EVENT_LABEL[event], on: state.events[event], coveredBy: reader.master ? null : "All notifications are switched off." }),
  );
  const groups = buildGroups(ctx, reader);
  const partial = { master, transports, jobEvents, groups, topics: null };
  return {
    subject: { kind: "CLIENT", id: client.id, name: client.name, role: "CLIENT", hasEmail, hasPhone },
    revision: client.notificationPref?.switchRevision ?? 0,
    timeZone: ctx.settings.timezone || "Australia/Sydney",
    ...partial,
    account: null,
    logins: client.users.map((user) => ({ id: user.id, name: user.name, email: user.email, offCount: userOffCount(userStateFromRow(user as never)) })),
    offCount: countOff(partial),
    canEdit: access.canEdit,
    readOnlyReason: access.readOnlyReason,
  };
}
