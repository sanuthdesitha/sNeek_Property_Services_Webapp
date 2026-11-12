import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { canUseOpsPath, opsRequestFeature } from "./ops-catalog";
import { policyChanges, touchesOwnAccess } from "./access-diff";
import { GRANT_CAPABILITY_KEYS, type CapabilityKey } from "./capabilities";
import {
  EMPTY_OPS_POLICY,
  isOpsSubject,
  opsPolicySchema,
  resolveOpsLevels,
  type OpsPolicy,
} from "./ops-policy";

export const OPS_POLICY_KEY = "ops_feature_permissions_v1";
export const OPS_PATH_HEADER = "x-sneek-request-path";
export const OPS_METHOD_HEADER = "x-sneek-request-method";
export async function getOpsPolicy(): Promise<OpsPolicy> {
  const record = await db.appSetting.findUnique({
    where: { key: OPS_POLICY_KEY },
  });
  // Missing is the explicit backwards-compatible default. Corrupt is NOT missing.
  return record ? opsPolicySchema.parse(record.value) : { ...EMPTY_OPS_POLICY };
}
export async function getOpsAccess(user: {
  id: string;
  role: string;
  heldRoles?: string[];
}) {
  if (!isOpsSubject(user)) return null;
  return resolveOpsLevels(await getOpsPolicy(), user.id);
}
/**
 * Administrator capabilities granted to this person (owner-only routes they
 * may open). Empty for administrators (they need none) and for non-subjects.
 */
export async function getOpsGrants(user: {
  id: string;
  role: string;
  heldRoles?: string[];
}): Promise<CapabilityKey[]> {
  if (!isOpsSubject(user)) return [];
  const policy = await getOpsPolicy();
  return GRANT_CAPABILITY_KEYS.filter((key) => policy.assignments[user.id]?.capabilities?.[key] === true);
}
export async function enforceOpsRequest(user: {
  id: string;
  role: string;
  heldRoles?: string[];
}) {
  if (!isOpsSubject(user)) return;
  const request = headers();
  const path = request.get(OPS_PATH_HEADER);
  if (!path) throw new Error("FORBIDDEN");
  const feature = opsRequestFeature(path);
  if (feature === null) return;
  const policy = await getOpsPolicy();
  const levels = resolveOpsLevels(policy, user.id);
  // Owner-only routes open only with the matching administrator capability.
  const grants = feature === "owner"
    ? GRANT_CAPABILITY_KEYS.filter((key) => policy.assignments[user.id]?.capabilities?.[key] === true)
    : [];
  if (!canUseOpsPath(levels, path, request.get(OPS_METHOD_HEADER) ?? "GET", grants))
    throw new Error("FORBIDDEN");
}

/** Who saved, recorded with every change (the route refuses impersonated saves). */
export type OpsPolicySaveContext = {
  impersonatedBy?: string | null;
  ipAddress?: string | null;
};

export async function saveOpsPolicy(
  actorId: string,
  input: OpsPolicy,
  context: OpsPolicySaveContext = {},
): Promise<OpsPolicy> {
  const parsed = opsPolicySchema.parse(input);
  return db.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${OPS_POLICY_KEY}))`;
    const before = await transaction.appSetting.upsert({
      where: { key: OPS_POLICY_KEY },
      create: { key: OPS_POLICY_KEY, value: EMPTY_OPS_POLICY },
      update: {},
    });
    const previous = opsPolicySchema.parse(before.value);
    if (previous.revision !== parsed.revision) throw new Error("OPS_POLICY_CONFLICT");
    // Nobody raises (or changes) their own access, whatever their role.
    if (touchesOwnAccess(previous, parsed, actorId)) throw new Error("OPS_POLICY_SELF_CHANGE");
    const after = { ...parsed, revision: parsed.revision + 1 };
    const result = await transaction.appSetting.updateMany({
      where: {
        key: OPS_POLICY_KEY,
        value: { path: ["revision"], equals: parsed.revision },
      },
      data: { value: after },
    });
    if (result.count !== 1) throw new Error("OPS_POLICY_CONFLICT");
    await transaction.auditLog.create({
      data: {
        userId: actorId,
        action: "OPS_PERMISSIONS_UPDATED",
        entity: "AppSettings",
        entityId: "app",
        before: previous,
        after: {
          ...after,
          audit: {
            actorId,
            actorRole: "ADMIN",
            impersonatedBy: context.impersonatedBy ?? null,
            changes: policyChanges(previous, after).length,
          },
        },
        ipAddress: context.ipAddress ?? undefined,
      },
    });
    return after;
  });
}
