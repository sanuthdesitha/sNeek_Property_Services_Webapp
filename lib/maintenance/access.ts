import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl, publicUrl } from "@/lib/s3";
import { isAirbnbProperty } from "@/lib/maintenance/airbnb";

export const REPORTER_ROLES: Role[] = [
  Role.ADMIN,
  Role.OPS_MANAGER,
  Role.QA_INSPECTOR,
  Role.CLEANER,
  Role.CLIENT,
];

export const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.OPS_MANAGER];

/** The MaintenanceSource a given reporter role records under. */
export function sourceForRole(role: Role) {
  switch (role) {
    case Role.CLIENT:
      return "CLIENT" as const;
    case Role.CLEANER:
      return "CLEANER" as const;
    case Role.QA_INSPECTOR:
      return "QA" as const;
    default:
      return "ADMIN" as const;
  }
}

/** Resolve the clientId attached to a CLIENT user (null otherwise). */
export async function clientIdForUser(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { clientId: true } });
  return user?.clientId ?? null;
}

/**
 * Can this user report/view maintenance on this property? Returns the gating
 * facts the caller needs. Always enforces Airbnb gating.
 *  - ADMIN/OPS: any Airbnb property.
 *  - CLIENT: only their own (Airbnb) property; restricted to clientVisible items.
 *  - CLEANER/QA: only properties they are attached to via an Airbnb job; when a
 *    jobId is supplied it must be an AIRBNB_TURNOVER job they are on.
 */
export async function resolvePropertyAccess(opts: {
  userId: string;
  role: Role;
  propertyId: string;
  jobId?: string | null;
}): Promise<{ allowed: boolean; clientVisibleOnly: boolean; reason?: string }> {
  const { userId, role, propertyId, jobId } = opts;

  const airbnb = await isAirbnbProperty(propertyId);
  if (!airbnb) {
    return { allowed: false, clientVisibleOnly: false, reason: "NOT_AIRBNB" };
  }

  if (role === Role.ADMIN || role === Role.OPS_MANAGER) {
    return { allowed: true, clientVisibleOnly: false };
  }

  if (role === Role.CLIENT) {
    const clientId = await clientIdForUser(userId);
    if (!clientId) return { allowed: false, clientVisibleOnly: true, reason: "NO_CLIENT" };
    const property = await db.property.findFirst({
      where: { id: propertyId, clientId },
      select: { id: true },
    });
    if (!property) return { allowed: false, clientVisibleOnly: true, reason: "NOT_OWNER" };
    return { allowed: true, clientVisibleOnly: true };
  }

  if (role === Role.CLEANER) {
    // Must be assigned to an AIRBNB_TURNOVER job on this property (the given job
    // when supplied, otherwise any such job).
    const assignment = await db.jobAssignment.findFirst({
      where: {
        userId,
        removedAt: null,
        job: {
          propertyId,
          jobType: "AIRBNB_TURNOVER",
          ...(jobId ? { id: jobId } : {}),
        },
      },
      select: { id: true },
    });
    if (!assignment) return { allowed: false, clientVisibleOnly: false, reason: "NOT_ASSIGNED" };
    return { allowed: true, clientVisibleOnly: false };
  }

  if (role === Role.QA_INSPECTOR) {
    const assignment = await db.qaAssignment.findFirst({
      where: {
        OR: [{ assignedToId: userId }, { pickedUpById: userId }],
        job: {
          propertyId,
          jobType: "AIRBNB_TURNOVER",
          ...(jobId ? { id: jobId } : {}),
        },
      },
      select: { id: true },
    });
    if (!assignment) return { allowed: false, clientVisibleOnly: false, reason: "NOT_ASSIGNED" };
    return { allowed: true, clientVisibleOnly: false };
  }

  return { allowed: false, clientVisibleOnly: false, reason: "ROLE" };
}

/**
 * Resolve photo S3 keys → temporary preview URLs for safe client rendering.
 * Falls back to the public URL when presigning fails.
 */
export async function resolvePhotoUrls(photoKeys: unknown): Promise<Array<{ key: string; url: string }>> {
  const keys = Array.isArray(photoKeys)
    ? photoKeys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];
  if (keys.length === 0) return [];
  return Promise.all(
    keys.map(async (key) => {
      try {
        return { key, url: await getPresignedDownloadUrl(key, 600) };
      } catch {
        return { key, url: publicUrl(key) };
      }
    }),
  );
}
