import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

/** Properties whose photos never go to AI photo review (AppSetting, revisioned, audited). */
export const PHOTO_REVIEW_OPT_OUT_KEY = "ai_photo_review_opt_out_v1";

const optOutSchema = z.object({
  revision: z.number().int().nonnegative(),
  propertyIds: z.array(z.string().min(1).max(200)).max(5000),
}).strict();
export type PhotoReviewOptOut = z.infer<typeof optOutSchema>;
const EMPTY: PhotoReviewOptOut = { revision: 0, propertyIds: [] };

type Reader = Pick<Prisma.TransactionClient, "appSetting">;

/** A corrupt row fails closed: every property counts as opted out until it is fixed. */
export async function readPhotoReviewOptOut(database: Reader = db): Promise<PhotoReviewOptOut & { corrupt: boolean }> {
  const row = await database.appSetting.findUnique({ where: { key: PHOTO_REVIEW_OPT_OUT_KEY } });
  if (!row) return { ...EMPTY, corrupt: false };
  const parsed = optOutSchema.safeParse(row.value);
  return parsed.success ? { ...parsed.data, corrupt: false } : { ...EMPTY, corrupt: true };
}

export async function isPropertyOptedOut(propertyId: string, database: Reader = db): Promise<boolean> {
  const state = await readPhotoReviewOptOut(database);
  return state.corrupt || state.propertyIds.includes(propertyId);
}

export class OptOutConflict extends Error {
  constructor(public current: PhotoReviewOptOut) { super("Someone changed the opted-out properties after you opened them."); }
}

export async function savePhotoReviewOptOut(input: { expectedRevision: number; propertyIds: string[] }, actorUserId: string): Promise<PhotoReviewOptOut> {
  const propertyIds = Array.from(new Set(input.propertyIds)).sort();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PHOTO_REVIEW_OPT_OUT_KEY}))`;
    const current = await readPhotoReviewOptOut(tx);
    if (current.revision !== input.expectedRevision) throw new OptOutConflict({ revision: current.revision, propertyIds: current.propertyIds });
    const known = await tx.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true } });
    if (known.length !== propertyIds.length) throw new Error("One or more properties no longer exist.");
    const next = optOutSchema.parse({ revision: current.revision + 1, propertyIds });
    await tx.appSetting.upsert({ where: { key: PHOTO_REVIEW_OPT_OUT_KEY }, create: { key: PHOTO_REVIEW_OPT_OUT_KEY, value: next }, update: { value: next } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "AI_PHOTO_REVIEW_OPT_OUT_UPDATED", entity: "AppSetting", entityId: PHOTO_REVIEW_OPT_OUT_KEY, before: { propertyIds: current.propertyIds }, after: { propertyIds } } });
    return next;
  });
}
