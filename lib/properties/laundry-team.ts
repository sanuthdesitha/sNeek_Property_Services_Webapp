import "server-only";
/**
 * Sets which laundry accounts service a property (`accessInfo.laundryTeamUserIds`,
 * the allocation the property page edits and lib/laundry/teams.ts reads). The
 * stored accessInfo is merged, never rebuilt, so access text, attachments and
 * onboarding keys survive; a legacy plaintext door code still in the JSON is
 * carried into the encrypted column before the merge scrubs it.
 */
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { buildPropertyAccessInfo, pickLegacyAccessCode } from "./access-info";

export type LaundryTeamOutcome =
  | { outcome: "done"; message: string }
  | { outcome: "unchanged"; message: string }
  | { outcome: "refused"; message: string };

/** Active LAUNDRY accounts among the ids, in the order given. Unknown or inactive ids are reported. */
export async function resolveLaundryAccounts(userIds: string[]): Promise<{ valid: Array<{ id: string; name: string }>; invalid: string[] }> {
  const users = await db.user.findMany({
    where: { id: { in: userIds }, role: Role.LAUNDRY, isActive: true },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  return {
    valid: userIds.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)?.name ?? byId.get(id)?.email ?? id })),
    invalid: userIds.filter((id) => !byId.has(id)),
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

export async function setPropertyLaundryTeam(propertyId: string, userIds: string[], actorId: string): Promise<LaundryTeamOutcome> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${propertyId} FOR UPDATE`;
    const property = await tx.property.findUnique({
      where: { id: propertyId },
      select: { isActive: true, laundryEnabled: true, accessInfo: true, accessCode: true },
    });
    if (!property || !property.isActive) return { outcome: "refused", message: "Property not found or archived." };
    if (property.laundryEnabled === false) return { outcome: "refused", message: "Laundry service is off for this property." };

    const merged = buildPropertyAccessInfo({ accessInfo: { laundryTeamUserIds: userIds } }, property.accessInfo);
    const before = buildPropertyAccessInfo({}, property.accessInfo).laundryTeamUserIds;
    if (sameSet(before, merged.laundryTeamUserIds)) return { outcome: "unchanged", message: "Already set." };

    const legacyCode = pickLegacyAccessCode(property.accessInfo);
    const keepLegacyCode = legacyCode !== null && !decryptSecret(property.accessCode);
    await tx.property.update({
      where: { id: propertyId },
      data: {
        accessInfo: merged as Prisma.InputJsonValue,
        ...(keepLegacyCode ? { accessCode: encryptSecret(legacyCode) } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "PROPERTY_LAUNDRY_TEAM_SET",
        entity: "Property",
        entityId: propertyId,
        before: { laundryTeamUserIds: before },
        after: { laundryTeamUserIds: merged.laundryTeamUserIds },
      },
    });
    return { outcome: "done", message: userIds.length === 0 ? "Allocation cleared." : "Laundry partner set." };
  });
}

export type LaundryTeamMember = { id: string; name: string; partnerName: string | null; turnaroundHours: number | null; active: boolean };

/** The allocated laundry accounts with the partner (supplier) each belongs to, in allocation order. */
export async function describeLaundryTeam(userIds: string[]): Promise<LaundryTeamMember[]> {
  if (userIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, isActive: true, laundrySupplier: { select: { name: true, avgTurnaround: true } } },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  return userIds.flatMap((id) => {
    const user = byId.get(id);
    if (!user) return [];
    return [{
      id,
      name: user.name ?? user.email ?? id,
      partnerName: user.laundrySupplier?.name ?? null,
      turnaroundHours: user.laundrySupplier?.avgTurnaround ?? null,
      active: user.isActive,
    }];
  });
}
