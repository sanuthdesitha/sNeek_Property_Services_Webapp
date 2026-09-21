import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolveHistoricalMediaField, isHistoricalSubmissionImageKey } from "@/lib/ai/historical-media";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { photoMemoryKey, parsePhotoMemoryExclusions } from "@/lib/ai/photo-memory-settings";
import { enqueuePropertyModelTraining } from "@/lib/ai/property-model-training";
import { getVisionSettings } from "@/lib/ai/vision-settings";
import { getRecognitionConfiguration } from "@/lib/ai/property-photo-model";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const bodySchema = z.object({ propertyId: idSchema, mediaId: idSchema, excluded: z.boolean(), reason: z.string().trim().min(3).max(1000) }).strict();
class MemoryError extends Error { constructor(public status: number, message: string) { super(message); } }
function failure(error: unknown) {
  const auth = error instanceof Error && ["UNAUTHORIZED", "FORBIDDEN"].includes(error.message);
  const status = auth ? ((error as Error).message === "UNAUTHORIZED" ? 401 : 403) : error instanceof MemoryError ? error.status : error instanceof z.ZodError ? 400 : 503;
  return NextResponse.json({ error: auth || error instanceof MemoryError ? (error as Error).message : status === 400 ? "Invalid photo memory request." : "Could not load or update photo memory. Refresh and try again." }, { status, headers });
}
export async function GET(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) throw new MemoryError(403, "FORBIDDEN");
    const params = new URL(request.url).searchParams;
    if (!params.has("propertyId")) {
      const q = (params.get("q") ?? "").trim().slice(0, 100);
      const properties = await db.property.findMany({ where: q ? { name: { contains: q, mode: "insensitive" } } : {}, orderBy: [{ name: "asc" }, { id: "asc" }], take: 50, select: { id: true, name: true } });
      return NextResponse.json({ properties }, { headers });
    }
    const propertyId = idSchema.parse(params.get("propertyId"));
    const offset = z.coerce.number().int().min(0).max(100_000).parse(params.get("offset") ?? 0);
    const property = await db.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new MemoryError(404, "Property not found.");
    const saved = await db.appSetting.findUnique({ where: { key: photoMemoryKey(propertyId) } });
    const excluded = new Set(parsePhotoMemoryExclusions(saved?.value));
    const items: { id: string; fieldId: string; fieldLabel: string; sectionLabel: string; submittedAt: string; sourceJobId: string; url: string | null; excluded: boolean }[] = [];
    let scanOffset = offset, nextOffset: number | null = null;
    const seen = new Set<string>();
    const previewKeys = new Map<string, string>();
    // Read past pages of unsupported evidence instead of showing an empty first
    // page when older, labelled report photos are available further back.
    for (let page = 0; page < 5 && items.length < 60; page++) {
      const media = await db.submissionMedia.findMany({
        where: { mediaType: "PHOTO", submission: { job: { propertyId, status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] } } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: scanOffset, take: 61,
        include: { submission: { select: { data: true, template: { select: { schema: true } }, submittedById: true, createdAt: true, jobId: true } } },
      });
      let consumed = 0;
      for (const photo of media.slice(0, 60)) {
        consumed++;
        const field = resolveHistoricalMediaField(photo.submission, photo);
        if (!field || seen.has(photo.id) || !isHistoricalSubmissionImageKey(photo.s3Key, photo.submission.jobId, photo.submission.submittedById)) continue;
        seen.add(photo.id);
        previewKeys.set(photo.id, photo.s3Key);
        items.push({ id: photo.id, fieldId: field.id, fieldLabel: field.label, sectionLabel: field.sectionLabel, submittedAt: photo.submission.createdAt.toISOString(), sourceJobId: photo.submission.jobId, url: null, excluded: excluded.has(photo.id) });
        if (items.length === 60) break;
      }
      scanOffset += consumed;
      nextOffset = media.length > consumed ? scanOffset : null;
      if (nextOffset === null) break;
    }
    await Promise.all(items.map(async item => { item.url = await getPresignedDownloadUrl(previewKeys.get(item.id)!, 600).catch(() => null); }));
    const training = await db.aiPropertyModelTraining.findUnique({ where: { propertyId }, select: { status: true, error: true, modelVersion: true, lastTrainedAt: true, metricsJson: true } });
    return NextResponse.json({ property: { id: property.id, name: property.name }, items, nextOffset, training, modelConfigured: getRecognitionConfiguration().configured, trainingEnabled: (await getVisionSettings()).dedicatedRecognitionEnabled }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) throw new MemoryError(403, "FORBIDDEN");
    const body = bodySchema.parse(await request.json().catch(() => null));
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${body.propertyId} FOR UPDATE`;
      const photo = await tx.submissionMedia.findFirst({ where: { id: body.mediaId, mediaType: "PHOTO", submission: { job: { propertyId: body.propertyId } } }, select: { id: true } });
      if (!photo) throw new MemoryError(404, "Photo not found for this property.");
      const key = photoMemoryKey(body.propertyId);
      const saved = await tx.appSetting.findUnique({ where: { key } });
      const ids = new Set(parsePhotoMemoryExclusions(saved?.value));
      if (ids.has(photo.id) === body.excluded) return;
      if (body.excluded) ids.add(photo.id); else ids.delete(photo.id);
      if (ids.size > 1000) throw new MemoryError(409, "This property has reached the exclusion limit. Restore unused exclusions before adding another.");
      const value = { excludedMediaIds: Array.from(ids) };
      await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await enqueuePropertyModelTraining(body.propertyId, tx);
      await tx.auditLog.create({ data: { userId: session.user.id, action: "AI_PHOTO_MEMORY_CHANGE", entity: "Property", entityId: body.propertyId, after: { mediaId: photo.id, excluded: body.excluded, reason: body.reason } } });
    });
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) throw new MemoryError(403, "FORBIDDEN");
    const body = z.object({ propertyId: idSchema }).strict().parse(await request.json().catch(() => null));
    if (!(await getVisionSettings()).dedicatedRecognitionEnabled || !getRecognitionConfiguration().configured) throw new MemoryError(409, "Configure and enable the dedicated recognition service first.");
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${body.propertyId} FOR UPDATE`;
      if (!await tx.property.findUnique({ where: { id: body.propertyId }, select: { id: true } })) throw new MemoryError(404, "Property not found.");
      await enqueuePropertyModelTraining(body.propertyId, tx, true);
      await tx.auditLog.create({ data: { userId: session.user.id, action: "AI_PROPERTY_TRAINING_REQUEST", entity: "Property", entityId: body.propertyId } });
    });
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}
