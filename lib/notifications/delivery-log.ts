import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ListQueryError, listResponse, parseListQuery, type ListResponse } from "@/lib/admin/list-query";
import { catalogEntry } from "./catalog";
import { NOTIFICATION_TRANSPORTS } from "./catalog-types";
import {
  DELIVERY_STATES, intentRow, mergePage, notificationRow, templateLogRow, redactSensitiveText,
  type DeliveryLogRow, type DeliveryState,
} from "./delivery-log-map";

/**
 * The unified delivery log: pipeline intents, legacy Notification rows (inbox,
 * email, SMS from every direct producer) and NotificationLog rows (template
 * engine and email provider events), in one time-sorted, paged list with real
 * totals. Filtering happens in the database for each source; a combined page
 * merges each source's sorted prefix, which is exact for a time sort.
 */
export const DELIVERY_LOG_SORTS = ["time"] as const;
const MERGE_WINDOW = 1000;

export const deliveryFiltersSchema = z.object({
  type: z.string().trim().max(100).optional(),
  state: z.enum(DELIVERY_STATES).optional(),
  transport: z.enum([...NOTIFICATION_TRANSPORTS]).optional(),
  recipient: z.string().trim().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: z.enum(["intent", "notification", "template_log"]).optional(),
});
export type DeliveryFilters = z.infer<typeof deliveryFiltersSchema>;

type Range = { gte?: Date; lte?: Date } | undefined;
const range = (filters: DeliveryFilters): Range =>
  filters.from || filters.to ? { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } : undefined;

const INTENT_STATE: Partial<Record<DeliveryState, Prisma.NotificationIntentWhereInput>> = {
  queued: { status: "QUEUED" }, retry_wait: { status: "RETRY_WAIT" }, processing: { status: "PROCESSING" },
  inbox_available: { status: "ACCEPTED", transport: "INBOX" }, provider_accepted: { status: "ACCEPTED", transport: { not: "INBOX" } },
  failed: { status: "FAILED" }, uncertain: { status: "UNCERTAIN" }, skipped: { status: "SKIPPED" },
};
const NOTIFICATION_STATE: Partial<Record<DeliveryState, Prisma.NotificationWhereInput>> = {
  queued: { status: "PENDING" }, failed: { status: "FAILED" },
  inbox_available: { status: "SENT", channel: "PUSH" },
  provider_accepted: { status: "SENT", channel: { in: ["EMAIL", "SMS"] }, externalId: { not: null }, OR: [{ deliveryStatus: null }, { deliveryStatus: "PENDING" }] },
  delivered: { deliveryStatus: "DELIVERED" }, opened: { deliveryStatus: "OPENED" }, bounced: { deliveryStatus: "BOUNCED" },
  sent_recorded: { status: "SENT", channel: { in: ["EMAIL", "SMS"] }, externalId: null },
};
const LOG_STATE: Partial<Record<DeliveryState, Prisma.NotificationLogWhereInput>> = {
  sent_recorded: { status: "SENT", eventKey: { not: { startsWith: "email." } } }, failed: { status: "FAILED" }, skipped: { status: "SKIPPED" },
  delivered: { eventKey: "email.delivered" }, opened: { eventKey: "email.opened" }, bounced: { eventKey: { in: ["email.bounced", "email.complained"] } },
};

/** null = this source cannot contain matching rows. */
export function intentWhere(filters: DeliveryFilters, recipientIds: string[] | null): Prisma.NotificationIntentWhereInput | null {
  const and: Prisma.NotificationIntentWhereInput[] = [];
  if (filters.type) {
    const keys = catalogEntry(filters.type)?.eventKeys ?? [];
    if (!keys.length) return null;
    and.push({ eventKey: { in: keys } });
  }
  if (filters.state) { const state = INTENT_STATE[filters.state]; if (!state) return null; and.push(state); }
  if (filters.transport) {
    if (filters.transport === "MOBILE_PUSH") return null;
    and.push({ transport: filters.transport });
  }
  if (recipientIds) and.push({ recipientId: { in: recipientIds } });
  const created = range(filters);
  if (created) and.push({ createdAt: created });
  return { AND: and };
}

export function notificationWhere(filters: DeliveryFilters, recipientIds: string[] | null): Prisma.NotificationWhereInput | null {
  const and: Prisma.NotificationWhereInput[] = [];
  if (filters.type) {
    const subjects = catalogEntry(filters.type)?.logSubjects ?? [];
    if (!subjects.length) return null;
    and.push({ OR: subjects.flatMap((prefix) => [{ subject: { startsWith: prefix } }, { subject: { contains: `: ${prefix}` } }]) });
  }
  if (filters.state) { const state = NOTIFICATION_STATE[filters.state]; if (!state) return null; and.push(state); }
  if (filters.transport) {
    if (filters.transport === "WEB_PUSH") return null;
    if (filters.transport === "MOBILE_PUSH") and.push({ channel: "PUSH", externalId: { startsWith: "mobile-outbox:" } });
    else and.push({ channel: filters.transport === "INBOX" ? "PUSH" : filters.transport });
  }
  if (recipientIds) and.push({ userId: { in: recipientIds } });
  const created = range(filters);
  if (created) and.push({ createdAt: created });
  return { AND: and };
}

export function templateLogWhere(filters: DeliveryFilters): Prisma.NotificationLogWhereInput | null {
  const and: Prisma.NotificationLogWhereInput[] = [];
  if (filters.type && filters.type !== "money.finance_events") return null;
  if (filters.state) { const state = LOG_STATE[filters.state]; if (!state) return null; and.push(state); }
  if (filters.transport) {
    if (filters.transport !== "EMAIL" && filters.transport !== "SMS") return null;
    and.push({ channel: filters.transport });
  }
  if (filters.recipient) and.push({ recipientEmail: { contains: filters.recipient, mode: "insensitive" } });
  const created = range(filters);
  if (created) and.push({ createdAt: created });
  return { AND: and };
}

async function recipientIdsFor(text: string | undefined): Promise<string[] | null> {
  if (!text) return null;
  const users = await db.user.findMany({
    where: { OR: [{ id: text }, { email: { contains: text, mode: "insensitive" } }, { name: { contains: text, mode: "insensitive" } }] },
    select: { id: true }, take: 100,
  });
  return users.map((user) => user.id);
}

async function labels(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true, role: true } });
  return new Map(users.map((user) => [user.id, `${user.name ?? user.email ?? user.id} (${user.role.replace("_", " ").toLowerCase()})`]));
}

export async function listDeliveries(params: URLSearchParams): Promise<ListResponse<DeliveryLogRow, "time">> {
  const query = parseListQuery(params, { sortable: DELIVERY_LOG_SORTS, defaultSort: "time", defaultDir: "desc", defaultPageSize: 25 });
  const parsed = deliveryFiltersSchema.safeParse(Object.fromEntries(Array.from(params.entries()).filter(([key, value]) => key in deliveryFiltersSchema.shape && value !== "")));
  if (!parsed.success) throw new ListQueryError("Invalid delivery log filter.", "filter");
  const filters = parsed.data;
  const recipientIds = await recipientIdsFor(filters.recipient);
  const wanted = (source: NonNullable<DeliveryFilters["source"]>) => !filters.source || filters.source === source;
  const iWhere = wanted("intent") ? intentWhere(filters, recipientIds) : null;
  const nWhere = wanted("notification") ? notificationWhere(filters, recipientIds) : null;
  const lWhere = wanted("template_log") ? templateLogWhere(filters) : null;
  const single = [iWhere, nWhere, lWhere].filter(Boolean).length <= 1;
  const end = query.skip + query.take;
  if (!single && end > MERGE_WINDOW) throw new ListQueryError("Narrow the filters (type, transport or source) to page this far back.", "page");
  const window = single ? { skip: query.skip, take: query.take } : { skip: 0, take: end };
  const orderBy = [{ createdAt: query.dir }, { id: query.dir }] as const;

  const [intents, notifications, logs, intentTotal, notificationTotal, logTotal] = await Promise.all([
    iWhere ? db.notificationIntent.findMany({ where: iWhere, orderBy: [...orderBy], ...window, include: { attempts: { orderBy: { number: "desc" }, take: 1, select: { status: true } } } }) : [],
    nWhere ? db.notification.findMany({ where: nWhere, orderBy: [...orderBy], ...window, select: { id: true, userId: true, jobId: true, channel: true, status: true, subject: true, errorMsg: true, externalId: true, deliveryStatus: true, createdAt: true } }) : [],
    lWhere ? db.notificationLog.findMany({ where: lWhere, orderBy: [...orderBy], ...window }) : [],
    iWhere ? db.notificationIntent.count({ where: iWhere }) : 0,
    nWhere ? db.notification.count({ where: nWhere }) : 0,
    lWhere ? db.notificationLog.count({ where: lWhere }) : 0,
  ]);
  const names = await labels([...intents.map((row) => row.recipientId), ...notifications.map((row) => row.userId)]);
  const label = (id: string | null) => (id ? names.get(id) ?? "Removed account" : "No account (external address)");
  const rows = [
    intents.map((row) => {
      const envelope = row.envelope as { subject?: string | null; jobId?: string | null } | null;
      return intentRow({ ...row, lastAttemptStatus: row.attempts[0]?.status ?? null, subject: envelope?.subject ?? null, jobId: envelope?.jobId ?? null }, label(row.recipientId));
    }),
    notifications.map((row) => notificationRow(row, label(row.userId))),
    logs.map(templateLogRow),
  ];
  const page = single ? rows.flat() : mergePage(rows, query.dir, query.skip, query.take);
  return listResponse(page, intentTotal + notificationTotal + logTotal, query);
}

/** Safe metadata for one row. Never a message body, email HTML, address or secret. */
export async function deliveryDetail(rowId: string): Promise<Record<string, unknown> | null> {
  const [source, id] = [rowId.slice(0, rowId.indexOf(":")), rowId.slice(rowId.indexOf(":") + 1)];
  if (!id) return null;
  if (source === "intent") {
    const row = await db.notificationIntent.findUnique({ where: { id }, include: { attempts: { orderBy: { number: "asc" } } } });
    if (!row) return null;
    const envelope = (row.envelope ?? {}) as Record<string, unknown>;
    return {
      source, eventId: envelope.eventId, eventKey: row.eventKey, entity: envelope.entity, recipientScope: (envelope.recipient as { scope?: unknown } | undefined)?.scope,
      severity: envelope.severity, category: envelope.category, transport: row.transport, status: row.status, attemptCount: row.attemptCount,
      nextAttemptAt: row.nextAttemptAt, lastErrorCode: row.lastErrorCode, subject: redactSensitiveText(envelope.subject as string | null),
      bodyLength: typeof envelope.body === "string" ? envelope.body.length : 0, hasEmailHtml: typeof envelope.emailHtml === "string",
      mobilePushCategory: envelope.mobilePushCategory ?? null, recipientPreferences: envelope.recipientPreferences ?? "APPLY", url: envelope.url ?? null,
      attempts: row.attempts.map((attempt) => ({ number: attempt.number, status: attempt.status, errorCode: attempt.errorCode, providerReference: attempt.providerReference ? "recorded" : null, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt })),
    };
  }
  if (source === "notification") {
    const row = await db.notification.findUnique({ where: { id } });
    if (!row) return null;
    return {
      source, channel: row.channel, status: row.status, deliveryStatus: row.deliveryStatus, providerReference: row.externalId && !row.externalId.startsWith("mobile-outbox:") ? "recorded" : null,
      phonePush: row.externalId?.startsWith("mobile-outbox:") ? row.externalId.replace("mobile-outbox:", "") : null,
      subject: redactSensitiveText(row.subject), preview: redactSensitiveText(row.body).slice(0, 160), error: redactSensitiveText(row.errorMsg) || null,
      sentAt: row.sentAt, createdAt: row.createdAt, path: row.id.startsWith("intent-") ? "pipeline" : "direct",
    };
  }
  if (source === "log") {
    const row = await db.notificationLog.findUnique({ where: { id } });
    if (!row) return null;
    return { source: "template_log", eventKey: row.eventKey, recipientRole: row.recipientRole, channel: row.channel, status: row.status, subject: redactSensitiveText(row.subject), error: redactSensitiveText(row.error) || null, createdAt: row.createdAt };
  }
  return null;
}
