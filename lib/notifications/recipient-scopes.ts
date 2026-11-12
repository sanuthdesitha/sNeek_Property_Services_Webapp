import "server-only";
import type { Prisma, Role } from "@prisma/client";
import type { NotificationEnvelope } from "./intent-contract";
import { STAFF_MESSAGE_ROLES } from "./staff-roles";

/**
 * Recipient authorization adapters for the durable notification pipeline.
 *
 * The pipeline was built for one scope (ADMIN_OPERATIONS: active ADMIN and
 * OPS_MANAGER users) and deliberately refused every other recipient. Each scope
 * below is an explicit, named rule that is checked when the intent is queued
 * AND again when it is dispatched, against the current database — never a
 * general "any user" door:
 *
 * - JOB_ASSIGNED_CLEANER (id = job id): the recipient holds an assignment on
 *   the job that has not been removed, and the account is active.
 * - LAUNDRY_TASK_CLEANER (id = laundry task id): the same rule on the job that
 *   owns the laundry task.
 * - STAFF_MEMBER (id = recipient user id): an active staff account (not a
 *   client, VA or anonymous contact) addressed by name, for office messages.
 * - JOB_CLIENT_CONTACT (id = job id): an active CLIENT login whose client owns
 *   the job's property.
 * - LOST_ITEM_PROPERTY_CLIENT (id = lost and found item id): an active CLIENT
 *   login whose client owns the property the item was found at (the item
 *   stores `propertyId` without a relation, so the property is read here).
 *
 * In every scope the role recorded in the envelope must still be the
 * recipient's role: a role change between queueing and dispatch skips the
 * delivery instead of disclosing to a different kind of account.
 */
export const RECIPIENT_SCOPE_TYPES = ["JOB_ASSIGNED_CLEANER", "LAUNDRY_TASK_CLEANER", "STAFF_MEMBER", "JOB_CLIENT_CONTACT", "LOST_ITEM_PROPERTY_CLIENT"] as const;
export type RecipientScopeType = (typeof RECIPIENT_SCOPE_TYPES)[number];

export { STAFF_MESSAGE_ROLES };

export type RecipientAuthorization =
  | { ok: true; role: Role }
  | { ok: false; errorCode: "recipient_unavailable" | "recipient_not_in_scope" | "unsupported_recipient_scope" };

type ScopeReader = Pick<Prisma.TransactionClient, "user" | "jobAssignment" | "laundryTask" | "job"> & Partial<Pick<Prisma.TransactionClient, "lostFoundItem" | "property">>;
type Recipient = NotificationEnvelope["recipient"];

export function isSupportedEntityScope(type: string): type is RecipientScopeType {
  return (RECIPIENT_SCOPE_TYPES as readonly string[]).includes(type);
}

async function activeAssignment(reader: ScopeReader, jobId: string, userId: string) {
  const assignment = await reader.jobAssignment.findFirst({
    where: { jobId, userId, removedAt: null },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function jobClientId(reader: ScopeReader, jobId: string) {
  const job = await reader.job.findUnique({ where: { id: jobId }, select: { property: { select: { clientId: true } } } });
  return job?.property?.clientId ?? null;
}

/** The client that owns the property a lost item was found at, or null. */
async function lostItemClientId(reader: ScopeReader, itemId: string) {
  if (!reader.lostFoundItem || !reader.property) return null;
  const item = await reader.lostFoundItem.findUnique({ where: { id: itemId }, select: { propertyId: true } });
  if (!item?.propertyId) return null;
  const property = await reader.property.findUnique({ where: { id: item.propertyId }, select: { clientId: true } });
  return property?.clientId ?? null;
}

/**
 * Current authorization of one recipient for an ENTITY scope. ADMIN_OPERATIONS
 * keeps its original inline rule in the dispatchers and is not handled here.
 */
export async function authorizeEntityRecipient(reader: ScopeReader, recipient: Recipient): Promise<RecipientAuthorization> {
  const scope = recipient.scope;
  if (scope.kind !== "ENTITY" || !isSupportedEntityScope(scope.type)) return { ok: false, errorCode: "unsupported_recipient_scope" };
  const user = await reader.user.findUnique({
    where: { id: recipient.userId },
    select: { id: true, role: true, isActive: true, clientId: true },
  });
  if (!user?.isActive || user.role !== recipient.role) return { ok: false, errorCode: "recipient_unavailable" };

  switch (scope.type) {
    case "JOB_ASSIGNED_CLEANER":
      return (await activeAssignment(reader, scope.id, user.id)) ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    case "LAUNDRY_TASK_CLEANER": {
      const task = await reader.laundryTask.findUnique({ where: { id: scope.id }, select: { jobId: true } });
      if (!task) return { ok: false, errorCode: "recipient_not_in_scope" };
      return (await activeAssignment(reader, task.jobId, user.id)) ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    }
    case "STAFF_MEMBER":
      return scope.id === user.id && STAFF_MESSAGE_ROLES.includes(user.role) ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    case "JOB_CLIENT_CONTACT": {
      if (user.role !== "CLIENT" || !user.clientId) return { ok: false, errorCode: "recipient_not_in_scope" };
      return (await jobClientId(reader, scope.id)) === user.clientId ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    }
    case "LOST_ITEM_PROPERTY_CLIENT": {
      if (user.role !== "CLIENT" || !user.clientId) return { ok: false, errorCode: "recipient_not_in_scope" };
      return (await lostItemClientId(reader, scope.id)) === user.clientId ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    }
  }
}
