import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { deleteDerivative } from "./storage";
import { CONSENT_WORDING_VERSION, type ConsentMethod, type ConsentView } from "./consent-rules";

/**
 * Marketing permission register (social post generator, 2026-11-17).
 *
 * A photo can be offered, exported, drafted, approved or posted only while a
 * recorded, unended permission row of the property's CURRENT client covers
 * that property. The register is append-only (a database trigger refuses
 * DELETE and every UPDATE except ending a row once); a change of terms ends
 * the old row and creates a new one, both in one transaction under a lock
 * per client.
 *
 * Revoking (or a new row that leaves a property out) removes unposted drafts
 * of those properties with their derivative files, and marks posted posts
 * "removal needed" for a person to take down. sNeek never claims it removed
 * a post from a network.
 */

export type ActiveConsent = {
  consentId: string;
  clientId: string;
  allowSuburb: boolean;
  allowBefore: boolean;
  method: ConsentMethod;
  givenByName: string;
  givenAt: Date;
};

export class ConsentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ConsentError";
  }
}

type Client = Prisma.TransactionClient | typeof db;

/**
 * The live permission per property. A row whose client is no longer the
 * property's client does not count (a property moved to another owner keeps
 * no permission).
 */
export async function activeConsents(propertyIds: readonly string[], database: Client = db): Promise<Map<string, ActiveConsent>> {
  const result = new Map<string, ActiveConsent>();
  const unique = Array.from(new Set(propertyIds));
  if (unique.length === 0) return result;
  const [links, properties] = await Promise.all([
    database.marketingConsentProperty.findMany({
      where: { propertyId: { in: unique }, consent: { endedAt: null } },
      select: { propertyId: true, consent: { select: { id: true, clientId: true, allowSuburb: true, allowBefore: true, method: true, givenByName: true, givenAt: true } } },
    }),
    database.property.findMany({ where: { id: { in: unique } }, select: { id: true, clientId: true } }),
  ]);
  const owner = new Map(properties.map((property) => [property.id, property.clientId]));
  for (const link of links) {
    if (owner.get(link.propertyId) !== link.consent.clientId) continue;
    result.set(link.propertyId, {
      consentId: link.consent.id,
      clientId: link.consent.clientId,
      allowSuburb: link.consent.allowSuburb,
      allowBefore: link.consent.allowBefore,
      method: link.consent.method as ConsentMethod,
      givenByName: link.consent.givenByName,
      givenAt: link.consent.givenAt,
    });
  }
  return result;
}

export type CascadeResult = { draftsRemoved: number; filesNotRemoved: number; postedFlagged: number; unpostedCancelled: number };

const POSTED_STATUSES = ["PUBLISHED", "SENT_TO_INBOX", "UNCONFIRMED", "SENDING"] as const;

/** Drafts of these properties go (with their files); posted posts are flagged for a person. */
async function cascadeForProperties(tx: Prisma.TransactionClient, propertyIds: string[], now: Date): Promise<{ result: CascadeResult; keys: string[] }> {
  const result: CascadeResult = { draftsRemoved: 0, filesNotRemoved: 0, postedFlagged: 0, unpostedCancelled: 0 };
  if (propertyIds.length === 0) return { result, keys: [] };
  const assets = await tx.marketingAsset.findMany({ where: { sourcePropertyId: { in: propertyIds }, derivativeKind: { not: null } }, select: { id: true, s3Key: true, socialGroupId: true } });
  const photoGroups = await tx.$queryRaw<Array<{ groupId: string }>>`
    SELECT DISTINCT gp."groupId"
    FROM "SocialPostGroupPhoto" gp
    JOIN "SubmissionMedia" sm ON sm."id" = gp."submissionMediaId"
    JOIN "FormSubmission" fs ON fs."id" = sm."submissionId"
    JOIN "Job" j ON j."id" = fs."jobId"
    WHERE j."propertyId" = ANY(${propertyIds}::text[])`;
  const groupIds = new Set<string>(assets.map((asset) => asset.socialGroupId).filter((id): id is string => Boolean(id)));
  photoGroups.forEach((row) => groupIds.add(row.groupId));
  const keys: string[] = [];
  for (const groupId of Array.from(groupIds)) {
    const posts = await tx.socialPost.findMany({ where: { groupId }, select: { id: true, status: true } });
    const posted = posts.filter((post) => (POSTED_STATUSES as readonly string[]).includes(post.status));
    if (posted.length === 0) {
      const groupAssets = await tx.marketingAsset.findMany({ where: { socialGroupId: groupId }, select: { id: true, s3Key: true } });
      keys.push(...groupAssets.map((asset) => asset.s3Key).filter((key): key is string => Boolean(key)));
      await tx.socialPost.deleteMany({ where: { groupId } });
      await tx.marketingAsset.deleteMany({ where: { socialGroupId: groupId } });
      await tx.socialPostGroup.delete({ where: { id: groupId } });
      result.draftsRemoved += 1;
      continue;
    }
    const cancelled = await tx.socialPost.updateMany({
      where: { groupId, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } },
      data: { status: "CANCELLED", failureReason: "Marketing permission was revoked before this network was posted." },
    });
    result.unpostedCancelled += cancelled.count;
    await tx.socialPostGroup.update({ where: { id: groupId }, data: { plannedFor: null, status: "POSTED" } });
  }
  // Every posted post that shows a photo of these properties needs a person to take it down.
  const flagged = await tx.socialPost.updateMany({
    where: {
      status: { in: ["PUBLISHED", "SENT_TO_INBOX", "UNCONFIRMED"] },
      removalNeededAt: null,
      assets: { some: { asset: { sourcePropertyId: { in: propertyIds } } } },
    },
    data: { removalNeededAt: now },
  });
  result.postedFlagged = flagged.count;
  return { result, keys };
}

async function removeFiles(keys: string[]): Promise<number> {
  let failed = 0;
  for (const key of keys) {
    if (!(await deleteDerivative(key))) failed += 1;
  }
  if (failed) logger.warn({ failed }, "[social] derivative files left after revoke");
  return failed;
}

export type ConsentActor = { userId: string; via: "OFFICE" | "PORTAL" };

type NewConsent = {
  clientId: string;
  propertyIds: string[];
  allowSuburb: boolean;
  allowBefore: boolean;
  method: ConsentMethod;
  givenByName: string;
  givenByUserId?: string | null;
  recordedById?: string | null;
  evidenceS3Key?: string | null;
  evidenceNote?: string | null;
};

async function lockClient(tx: Prisma.TransactionClient, clientId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`marketing-consent:${clientId}`}))`;
}

/**
 * Records a permission (replacing the client's live one, if any). Properties
 * must belong to the client. Properties the old row covered and the new one
 * does not are cascaded as a revoke.
 */
export async function recordConsent(input: NewConsent, actor: ConsentActor, now = new Date()): Promise<{ consentId: string; cascade: CascadeResult }> {
  const propertyIds = Array.from(new Set(input.propertyIds));
  const { consentId, cascade, keys } = await db.$transaction(async (tx) => {
    await lockClient(tx, input.clientId);
    const owned = await tx.property.findMany({ where: { id: { in: propertyIds }, clientId: input.clientId }, select: { id: true } });
    if (owned.length !== propertyIds.length) throw new ConsentError(400, "Every property must belong to this client.");
    const current = await tx.marketingConsent.findFirst({ where: { clientId: input.clientId, endedAt: null }, include: { properties: true } });
    let dropped: string[] = [];
    if (current) {
      dropped = current.properties.map((row) => row.propertyId).filter((id) => !propertyIds.includes(id));
      await tx.marketingConsent.update({ where: { id: current.id }, data: { endedAt: now, endedById: actor.userId, endedVia: "REPLACED", endedReason: "Replaced by a newer permission" } });
    }
    const created = await tx.marketingConsent.create({
      data: {
        clientId: input.clientId,
        allowSuburb: input.allowSuburb,
        allowBefore: input.allowBefore,
        method: input.method,
        givenByName: input.givenByName,
        givenByUserId: input.givenByUserId ?? null,
        recordedById: input.recordedById ?? null,
        evidenceS3Key: input.evidenceS3Key ?? null,
        evidenceNote: input.evidenceNote ?? null,
        wordingVersion: CONSENT_WORDING_VERSION,
        givenAt: now,
        properties: { create: propertyIds.map((propertyId) => ({ propertyId })) },
      },
    });
    const cascaded = await cascadeForProperties(tx, dropped, now);
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "MARKETING_CONSENT_RECORDED",
        entity: "MarketingConsent",
        entityId: created.id,
        after: { clientId: input.clientId, propertyIds, method: input.method, allowSuburb: input.allowSuburb, allowBefore: input.allowBefore, via: actor.via, replaced: current?.id ?? null, ...cascaded.result } as Prisma.InputJsonValue,
      },
    });
    return { consentId: created.id, cascade: cascaded.result, keys: cascaded.keys };
  });
  cascade.filesNotRemoved = await removeFiles(keys);
  return { consentId, cascade };
}

/** Ends the client's live permission and cascades it. Nothing to end is a 409. */
export async function revokeConsent(clientId: string, actor: ConsentActor, reason: string | null, now = new Date()): Promise<CascadeResult> {
  const { cascade, keys } = await db.$transaction(async (tx) => {
    await lockClient(tx, clientId);
    const current = await tx.marketingConsent.findFirst({ where: { clientId, endedAt: null }, include: { properties: true } });
    if (!current) throw new ConsentError(409, "There is no live permission to revoke for this client.");
    await tx.marketingConsent.update({ where: { id: current.id }, data: { endedAt: now, endedById: actor.userId, endedVia: actor.via, endedReason: reason?.slice(0, 500) ?? null } });
    const cascaded = await cascadeForProperties(tx, current.properties.map((row) => row.propertyId), now);
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "MARKETING_CONSENT_REVOKED",
        entity: "MarketingConsent",
        entityId: current.id,
        after: { clientId, via: actor.via, reason, ...cascaded.result } as Prisma.InputJsonValue,
      },
    });
    return { cascade: cascaded.result, keys: cascaded.keys };
  });
  cascade.filesNotRemoved = await removeFiles(keys);
  return cascade;
}

/** A person took a flagged post down on the network themselves. */
export async function markRemovalDone(postId: string, userId: string, now = new Date()): Promise<boolean> {
  const updated = await db.socialPost.updateMany({ where: { id: postId, removalNeededAt: { not: null }, removalDoneAt: null }, data: { removalDoneAt: now, removalDoneById: userId } });
  if (updated.count) {
    await db.auditLog.create({ data: { userId, action: "SOCIAL_POST_REMOVAL_MARKED_DONE", entity: "SocialPost", entityId: postId } });
  }
  return updated.count === 1;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** The whole register (newest first) with names resolved for the office. */
export async function listConsentRegister(input: { clientId?: string } = {}): Promise<ConsentView[]> {
  const rows = await db.marketingConsent.findMany({ where: input.clientId ? { clientId: input.clientId } : {}, orderBy: [{ givenAt: "desc" }], take: 500, include: { properties: true } });
  const clientIds = Array.from(new Set(rows.map((row) => row.clientId)));
  const propertyIds = Array.from(new Set(rows.flatMap((row) => row.properties.map((link) => link.propertyId))));
  const userIds = Array.from(new Set(rows.flatMap((row) => [row.recordedById, row.endedById]).filter((id): id is string => Boolean(id))));
  const [clients, properties, users] = await Promise.all([
    db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }),
    db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
  ]);
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const propertyName = new Map(properties.map((property) => [property.id, property.name]));
  const userName = new Map(users.map((user) => [user.id, user.name || user.email || "Office"]));
  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    clientName: clientName.get(row.clientId) ?? "Client no longer on file",
    properties: row.properties.map((link) => ({ id: link.propertyId, name: propertyName.get(link.propertyId) ?? "Property no longer on file" })),
    allowSuburb: row.allowSuburb,
    allowBefore: row.allowBefore,
    method: row.method as ConsentMethod,
    givenByName: row.givenByName,
    recordedByName: row.recordedById ? userName.get(row.recordedById) ?? null : null,
    hasEvidence: Boolean(row.evidenceS3Key),
    evidenceNote: row.evidenceNote,
    wordingVersion: row.wordingVersion,
    givenAt: row.givenAt.toISOString(),
    endedAt: iso(row.endedAt),
    endedVia: row.endedVia,
    endedByName: row.endedById ? userName.get(row.endedById) ?? null : null,
  }));
}
