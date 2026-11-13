import "server-only";
import type { Prisma, Role } from "@prisma/client";
import type { NotificationEnvelope } from "./intent-contract";
import { STAFF_MESSAGE_ROLES } from "./staff-roles";
import { propertyIsVisibleToLaundry } from "@/lib/laundry/teams";
import { EMPTY_OPS_POLICY, isOpsSubject, opsPolicySchema, resolveOpsLevels } from "@/lib/rbac/ops-policy";
import { evaluateCapability } from "@/lib/rbac/access-evaluator";
import { isAgentWriteScopeKey, agentWriteScope } from "@/lib/agents/write-scopes";

/** The AppSetting key of the operations policy (same as lib/rbac/ops-access.ts, which needs request headers). */
const OPS_POLICY_SETTING_KEY = "ops_feature_permissions_v1";

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
 * - LAUNDRY_TASK_SUPPLIER_TEAM (id = laundry task id, owner decision
 *   2026-11-12: pickup and drop-off are the laundry partner's work): an active
 *   LAUNDRY account linked to the run's supplier (`User.laundrySupplierId`)
 *   that may see the run's property under the laundry visibility rule
 *   (laundry service on; on the property's laundry team, or no team set).
 *   A run whose supplier changed, or a person moved to another partner, is
 *   skipped at dispatch.
 * - STAFF_MEMBER (id = recipient user id): an active staff account (not a
 *   client, VA or anonymous contact) addressed by name, for office messages.
 * - JOB_CLIENT_CONTACT (id = job id): an active CLIENT login whose client owns
 *   the job's property.
 * - LOST_ITEM_PROPERTY_CLIENT (id = lost and found item id): an active CLIENT
 *   login whose client owns the property the item was found at (the item
 *   stores `propertyId` without a relation, so the property is read here).
 *
 * - URGENT_STOCK_PURCHASE_ASK (id = urgent stock purchase ask id, Wave F): an
 *   active CLEANER who is the ask's cleaner while the ask is still ASKED (a
 *   withdrawn or answered ask is not delivered).
 *
 * - URGENT_STOCK_OFFICE (id = urgent stock need id, owner decision 2026-11-12):
 *   the office people who may see urgent stock: an active ADMIN, or an active
 *   OPS_MANAGER whose operations pack gives the inventory feature at least
 *   "read" (read from the live policy each time; a manager who also holds
 *   ADMIN has no pack restriction, as everywhere else).
 *
 * - JOB_OFFICE (id = job id, live location 2026-11): the office people who may
 *   see jobs: an active ADMIN, or an active OPS_MANAGER whose operations pack
 *   gives the jobs feature at least "read" (re-read each time, like
 *   URGENT_STOCK_OFFICE). Used for the automatic "left the site" clock-out.
 *
 * - AGENT_ACTION_APPROVER (id = agent action request id, step 6 2026-11-14):
 *   the people who could approve the request: an active ADMIN, or an active
 *   OPS_MANAGER whose pack gives Approvals at least "read" and every area of
 *   the request's write pack at "manage" (plus its capability). Only while the
 *   request is still WAITING (a decided or expired request is not delivered).
 *
 * In every scope the role recorded in the envelope must still be the
 * recipient's role: a role change between queueing and dispatch skips the
 * delivery instead of disclosing to a different kind of account.
 */
export const RECIPIENT_SCOPE_TYPES = ["JOB_ASSIGNED_CLEANER", "LAUNDRY_TASK_CLEANER", "LAUNDRY_TASK_SUPPLIER_TEAM", "STAFF_MEMBER", "JOB_CLIENT_CONTACT", "LOST_ITEM_PROPERTY_CLIENT", "URGENT_STOCK_PURCHASE_ASK", "URGENT_STOCK_OFFICE", "JOB_OFFICE", "AGENT_ACTION_APPROVER"] as const;
export type RecipientScopeType = (typeof RECIPIENT_SCOPE_TYPES)[number];

export { STAFF_MESSAGE_ROLES };

export type RecipientAuthorization =
  | { ok: true; role: Role }
  | { ok: false; errorCode: "recipient_unavailable" | "recipient_not_in_scope" | "unsupported_recipient_scope" };

type ScopeReader = Pick<Prisma.TransactionClient, "user" | "jobAssignment" | "laundryTask" | "job"> & Partial<Pick<Prisma.TransactionClient, "lostFoundItem" | "property" | "urgentStockPurchaseAsk" | "appSetting" | "agentActionRequest">>;
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
 * May this ADMIN / OPS_MANAGER account see urgent stock right now? ADMIN always;
 * an operations manager by the inventory feature of their pack (read or
 * manage). Fails closed when the policy cannot be read.
 */
export async function urgentStockOfficeRecipientAllowed(reader: ScopeReader, user: { id: string; role: Role }): Promise<boolean> {
  return officeFeatureRecipientAllowed(reader, user, "inventory");
}

/**
 * May this ADMIN / OPS_MANAGER account receive office notices of one
 * operations feature? ADMIN always; an operations manager by that feature of
 * their pack (read or manage). Fails closed when the policy cannot be read.
 */
export async function officeFeatureRecipientAllowed(reader: ScopeReader, user: { id: string; role: Role }, feature: "inventory" | "jobs"): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role !== "OPS_MANAGER" || !reader.appSetting) return false;
  const account = await reader.user.findUnique({ where: { id: user.id }, select: { extraRoles: { select: { role: true } } } });
  const heldRoles: string[] = [user.role, ...(account?.extraRoles ?? []).map((row) => row.role)];
  if (!isOpsSubject({ role: user.role, heldRoles })) return true;
  const record = await reader.appSetting.findUnique({ where: { key: OPS_POLICY_SETTING_KEY } });
  const parsed = record ? opsPolicySchema.safeParse(record.value) : null;
  if (parsed && !parsed.success) return false;
  // Missing policy is the documented backwards-compatible default (every feature at manage).
  const levels = resolveOpsLevels(parsed ? parsed.data : EMPTY_OPS_POLICY, user.id);
  return levels[feature] === "read" || levels[feature] === "manage";
}

/**
 * Could this ADMIN / OPS_MANAGER account approve this waiting agent request
 * right now? ADMIN always; an operations manager by Approvals (read or manage)
 * and every area of the request's write pack at manage, plus the pack's
 * capability. Fails closed when the request, its pack or the policy cannot be read.
 */
export async function agentApproverRecipientAllowed(reader: ScopeReader, user: { id: string; role: Role }, requestId: string): Promise<boolean> {
  if (!reader.agentActionRequest) return false;
  const request = await reader.agentActionRequest.findUnique({ where: { id: requestId }, select: { status: true, area: true } });
  if (!request || request.status !== "WAITING" || !isAgentWriteScopeKey(request.area)) return false;
  if (user.role === "ADMIN") return true;
  if (user.role !== "OPS_MANAGER" || !reader.appSetting) return false;
  const account = await reader.user.findUnique({ where: { id: user.id }, select: { extraRoles: { select: { role: true } } } });
  const heldRoles: string[] = [user.role, ...(account?.extraRoles ?? []).map((row) => row.role)];
  if (!isOpsSubject({ role: user.role, heldRoles })) return true;
  const record = await reader.appSetting.findUnique({ where: { key: OPS_POLICY_SETTING_KEY } });
  const parsed = record ? opsPolicySchema.safeParse(record.value) : null;
  if (parsed && !parsed.success) return false;
  const policy = parsed ? parsed.data : EMPTY_OPS_POLICY;
  const levels = resolveOpsLevels(policy, user.id);
  const pack = agentWriteScope(request.area);
  if (levels.approvals !== "read" && levels.approvals !== "manage") return false;
  if (!pack.opsAreas.every((area) => levels[area] === "manage")) return false;
  return !pack.capability || evaluateCapability(policy, { id: user.id, role: user.role, heldRoles }, pack.capability);
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
    select: { id: true, role: true, isActive: true, clientId: true, laundrySupplierId: true },
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
    case "LAUNDRY_TASK_SUPPLIER_TEAM": {
      if (user.role !== "LAUNDRY" || !user.laundrySupplierId) return { ok: false, errorCode: "recipient_not_in_scope" };
      const task = await reader.laundryTask.findUnique({ where: { id: scope.id }, select: { supplierId: true, property: { select: { accessInfo: true, laundryEnabled: true } } } });
      if (!task?.supplierId || task.supplierId !== user.laundrySupplierId) return { ok: false, errorCode: "recipient_not_in_scope" };
      return propertyIsVisibleToLaundry(task.property, user.id) ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
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
    case "URGENT_STOCK_PURCHASE_ASK": {
      if (user.role !== "CLEANER" || !reader.urgentStockPurchaseAsk) return { ok: false, errorCode: "recipient_not_in_scope" };
      const ask = await reader.urgentStockPurchaseAsk.findUnique({ where: { id: scope.id }, select: { cleanerId: true, state: true } });
      return ask && ask.cleanerId === user.id && ask.state === "ASKED" ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    }
    case "URGENT_STOCK_OFFICE":
      return (await urgentStockOfficeRecipientAllowed(reader, user)) ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    case "JOB_OFFICE": {
      const job = await reader.job.findUnique({ where: { id: scope.id }, select: { id: true } });
      if (!job) return { ok: false, errorCode: "recipient_not_in_scope" };
      return (await officeFeatureRecipientAllowed(reader, user, "jobs")) ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
    }
    case "AGENT_ACTION_APPROVER":
      return (await agentApproverRecipientAllowed(reader, user, scope.id)) ? { ok: true, role: user.role } : { ok: false, errorCode: "recipient_not_in_scope" };
  }
}
