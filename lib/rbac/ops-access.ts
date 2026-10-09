import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { canUseOpsPath, opsRequestFeature } from "./ops-catalog";
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
export async function enforceOpsRequest(user: {
  id: string;
  role: string;
  heldRoles?: string[];
}) {
  if (!isOpsSubject(user)) return;
  const request = headers();
  const path = request.get(OPS_PATH_HEADER);
  if (!path) throw new Error("FORBIDDEN");
  if (opsRequestFeature(path) === null) return;
  const levels = await getOpsAccess(user);
  if (
    levels &&
    !canUseOpsPath(levels, path, request.get(OPS_METHOD_HEADER) ?? "GET")
  )
    throw new Error("FORBIDDEN");
}

export async function saveOpsPolicy(
  actorId: string,
  input: OpsPolicy,
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
        after,
      },
    });
    return after;
  });
}
