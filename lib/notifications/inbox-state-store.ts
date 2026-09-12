import "server-only";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { isNotificationVisibleToRole, notificationWhereForRole } from "./feed";
import { emptyInboxState, inboxMutationSchema, inboxStateSchema, nextInboxState } from "./inbox-state";

export class InboxStateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const inboxStateKey = (userId: string, id: string) => `notification_inbox_v1:${encodeURIComponent(userId)}:${encodeURIComponent(id)}`;
function decode(value: unknown) {
  const parsed = inboxStateSchema.safeParse(value);
  if (!parsed.success) throw new InboxStateError(503, "Follow-up status could not be read.");
  return parsed.data;
}
export async function readInboxStates(userId: string, ids: string[]) {
  if (!ids.length) return {};
  const rows = await db.appSetting.findMany({ where: { key: { in: ids.map(id => inboxStateKey(userId, id)) } } });
  const byKey = new Map(rows.map(row => [row.key, row.value]));
  return Object.fromEntries(ids.map(id => { const key = inboxStateKey(userId, id); return [id, byKey.has(key) ? decode(byKey.get(key)) : emptyInboxState()]; }));
}
export async function changeInboxState(userId: string, role: Role, input: unknown) {
  const parsed = inboxMutationSchema.safeParse(input);
  if (!parsed.success) throw new InboxStateError(400, "Invalid follow-up action.");
  const { id, revision, action } = parsed.data;
  return db.$transaction(async tx => {
    const key = inboxStateKey(userId, id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const notification = await tx.notification.findFirst({ where: { ...notificationWhereForRole(role, userId), id } });
    if (!notification || !isNotificationVisibleToRole(notification, role)) throw new InboxStateError(404, "Notification is unavailable.");
    const stored = await tx.appSetting.findUnique({ where: { key } });
    const current = stored ? decode(stored.value) : emptyInboxState();
    if (current.revision !== revision) throw new InboxStateError(409, "Follow-up changed elsewhere. Refresh notifications before retrying.");
    if (action === "RESOLVE" && current.followUp !== "NEEDS_ACTION") throw new InboxStateError(409, "Only an active personal follow-up can be resolved. Refresh notifications.");
    const next = nextInboxState(current, action);
    await tx.appSetting.upsert({ where: { key }, create: { key, value: next }, update: { value: next } });
    await tx.auditLog.create({ data: { userId, action: `NOTIFICATION_INBOX_${action}`, entity: "Notification", entityId: id, before: current, after: next } });
    return next;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
}
