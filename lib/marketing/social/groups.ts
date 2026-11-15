import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { checkPhotos, type EligiblePhoto } from "./eligibility";
import { makeBeforeAfterSplit, makeFramedCrop, makeLabelledCrop, makeSocialCrop, type Derivative } from "./image-pipeline";
import { isSocialFormat, isSocialNetwork, SOCIAL_FORMATS, SOCIAL_NETWORK_KEYS, SOCIAL_RATIOS, type SocialFormat, type SocialNetwork, type SocialRatio, type SplitLayout } from "./networks";
import { renderNetworkCaption, suggestAltText, templateFor, type CaptionFacts } from "./captions";
import { socialPhotoField } from "./photo-fields";
import { deleteDerivative, newDerivativeKey, putDerivative, readEvidencePhoto } from "./storage";
import { getSocialTemplates } from "./templates-store";
import type { GroupView, NetworkPostView } from "./view-types";

/**
 * Composed social posts (2026-11-17): a SocialPostGroup with its photos (in
 * order, with alt text) and one SocialPost row per network. Older posts
 * without a group keep working ("Waiting for your link" / "Posted by you").
 *
 * Every change that affects the images (photos, order, format, shape,
 * layout, frame text) clears the "I looked at every photo" tick and the
 * cleaned copies made so far; they are made again before posting. Only a
 * draft can change: once any network was posted, the post is a record.
 */

export class GroupError extends Error {
  constructor(public status: number, message: string, public details: string[] = []) {
    super(message);
    this.name = "GroupError";
  }
}

export type GroupActor = { userId: string; via: "USER" | "AGENT"; agentActionRequestId?: string | null };

export type GroupCaptionInput = Partial<Record<SocialNetwork, { caption: string; hashtags?: string[] }>>;

export type NewGroupInput = {
  format: SocialFormat;
  ratio?: SocialRatio;
  photoIds: string[];
  title?: string | null;
  splitLayout?: SplitLayout | null;
  frameText?: string | null;
  captions?: GroupCaptionInput;
  altText?: Record<string, string>;
  templateKey?: string | null;
  hookIndex?: number;
};

export const POSTED_STATUSES = ["PUBLISHED", "SENT_TO_INBOX", "UNCONFIRMED", "SENDING"] as const;

function formatRule(format: SocialFormat) {
  return SOCIAL_FORMATS.find((item) => item.key === format)!;
}

/** Roles in a before/after post: the before photo first, then the after. */
function rolesFor(format: SocialFormat, photos: EligiblePhoto[]): Array<"PHOTO" | "BEFORE" | "AFTER"> {
  if (format !== "BEFORE_AFTER") return photos.map(() => "PHOTO");
  return photos.map((photo) => (photo.field.kind === "BEFORE" ? "BEFORE" : "AFTER"));
}

function validateShape(format: SocialFormat, photoIds: string[], photos: Map<string, EligiblePhoto>): void {
  const rule = formatRule(format);
  if (photoIds.length < rule.minPhotos || photoIds.length > rule.maxPhotos) {
    throw new GroupError(400, rule.minPhotos === rule.maxPhotos ? `${rule.label} needs exactly ${rule.minPhotos} photo${rule.minPhotos === 1 ? "" : "s"}.` : `${rule.label} needs ${rule.minPhotos} to ${rule.maxPhotos} photos.`);
  }
  if (format === "BEFORE_AFTER") {
    const chosen = photoIds.map((id) => photos.get(id)!);
    const befores = chosen.filter((photo) => photo.field.kind === "BEFORE");
    if (befores.length !== 1) throw new GroupError(400, "Before and after needs one before photo and one after photo.");
    if (chosen[0].jobId !== chosen[1].jobId) throw new GroupError(400, "A before and after pair must come from the same job.");
  }
  if (format !== "BEFORE_AFTER" && photoIds.some((id) => photos.get(id)?.field.kind === "BEFORE")) {
    throw new GroupError(400, "Before photos can only be used in a before and after post.");
  }
}

export async function captionFacts(photos: EligiblePhoto[]): Promise<CaptionFacts> {
  const suburbs = Array.from(new Set(photos.map((photo) => photo.suburb)));
  const bedrooms = Array.from(new Set(photos.map((photo) => photo.bedrooms)));
  const settings = await getAppSettings();
  const site = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
  return {
    // The suburb is named only when every photo's permission allows it, and they agree.
    suburb: suburbs.length === 1 && suburbs[0] ? suburbs[0] : null,
    bedrooms: bedrooms.length === 1 ? bedrooms[0] : null,
    rooms: photos.map((photo) => photo.field.room),
    link: site ? `${site}/quote` : `the ${settings.companyName || "sNeek"} website`,
  };
}

async function defaultCaptions(format: SocialFormat, photos: EligiblePhoto[], templateKey: string | null | undefined, hookIndex: number): Promise<Record<SocialNetwork, { caption: string; hashtags: string[] }>> {
  const { templates } = await getSocialTemplates();
  const template = templateFor(templates, format, templateKey);
  const facts = await captionFacts(photos);
  return Object.fromEntries(SOCIAL_NETWORK_KEYS.map((network) => [network, renderNetworkCaption(template, hookIndex, facts, network, templates)])) as Record<SocialNetwork, { caption: string; hashtags: string[] }>;
}

function titleFrom(photos: EligiblePhoto[]): string {
  const names = Array.from(new Set(photos.map((photo) => photo.propertyName)));
  return names.slice(0, 2).join(" + ") + (names.length > 2 ? ` + ${names.length - 2} more` : "");
}

/** Creates a DRAFT (people and approved agent requests). Every photo must be eligible now. */
export async function createGroup(input: NewGroupInput, actor: GroupActor): Promise<string> {
  if (!isSocialFormat(input.format)) throw new GroupError(400, "Choose a format.");
  const ratio = input.ratio && SOCIAL_RATIOS.includes(input.ratio) ? input.ratio : "4:5";
  const photoIds = Array.from(new Set(input.photoIds));
  const { eligible, refused } = await checkPhotos(photoIds, { ratio });
  if (refused.length) throw new GroupError(409, "Some photos cannot be used.", refused.map((item) => item.reason));
  validateShape(input.format, photoIds, eligible);
  const photos = photoIds.map((id) => eligible.get(id)!);
  const roles = rolesFor(input.format, photos);
  const captions = { ...(await defaultCaptions(input.format, photos, input.templateKey, input.hookIndex ?? 0)) };
  for (const [network, value] of Object.entries(input.captions ?? {})) {
    if (isSocialNetwork(network) && value) captions[network] = { caption: value.caption, hashtags: value.hashtags ?? captions[network].hashtags };
  }
  const group = await db.socialPostGroup.create({
    data: {
      format: input.format,
      ratio,
      title: (input.title?.trim() || titleFrom(photos)).slice(0, 160),
      createdVia: actor.via,
      createdById: actor.userId,
      agentActionRequestId: actor.agentActionRequestId ?? null,
      splitLayout: input.format === "BEFORE_AFTER" ? input.splitLayout ?? "SIDE" : null,
      frameText: input.format === "FRAME" ? input.frameText?.trim().slice(0, 32) || null : null,
      photos: {
        create: photos.map((photo, order) => ({
          submissionMediaId: photo.photoId,
          order,
          role: roles[order],
          altText: (input.altText?.[photo.photoId] ?? "").trim().slice(0, 1000),
        })),
      },
    },
  });
  for (const network of SOCIAL_NETWORK_KEYS) {
    await db.socialPost.create({
      data: { groupId: group.id, channel: network, status: "DRAFT", caption: captions[network].caption, hashtags: captions[network].hashtags, idempotencyKey: `${group.id}:${network}`, createdById: actor.userId },
    });
  }
  await db.auditLog.create({ data: { userId: actor.userId, action: "SOCIAL_DRAFT_CREATED", entity: "SocialPostGroup", entityId: group.id, after: { format: input.format, photos: photoIds.length, via: actor.via, agentActionRequestId: actor.agentActionRequestId ?? null } } });
  return group.id;
}

export type GroupUpdate = {
  expectedRevision: number;
  title?: string;
  format?: SocialFormat;
  ratio?: SocialRatio;
  photoIds?: string[];
  splitLayout?: SplitLayout | null;
  frameText?: string | null;
  altText?: Record<string, string>;
  beforeChecked?: string[];
  captions?: GroupCaptionInput;
  regenerateCaptions?: { templateKey: string | null; hookIndex: number; networks?: SocialNetwork[] };
};

async function requireDraft(groupId: string) {
  const group = await db.socialPostGroup.findUnique({ where: { id: groupId }, include: { photos: { orderBy: { order: "asc" } }, posts: true } });
  if (!group) throw new GroupError(404, "This post no longer exists. Its permission may have been revoked.");
  if (group.status === "CANCELLED") throw new GroupError(409, "This post was cancelled.");
  if (group.posts.some((post) => (POSTED_STATUSES as readonly string[]).includes(post.status))) throw new GroupError(409, "This post has gone out to a network, so it can no longer change.");
  return group;
}

/** Removes the cleaned copies made for a group (files first, best effort, then rows). */
async function dropDerivatives(tx: Prisma.TransactionClient, groupId: string): Promise<string[]> {
  const assets = await tx.marketingAsset.findMany({ where: { socialGroupId: groupId }, select: { id: true, s3Key: true } });
  await tx.marketingAsset.deleteMany({ where: { socialGroupId: groupId } });
  return assets.map((asset) => asset.s3Key).filter((key): key is string => Boolean(key));
}

export async function updateGroup(groupId: string, update: GroupUpdate, actorId: string): Promise<void> {
  const group = await requireDraft(groupId);
  if (group.revision !== update.expectedRevision) throw new GroupError(409, "Someone else changed this draft since you opened it. Reload to see their changes; your text is kept on screen.");
  const format = update.format ?? (group.format as SocialFormat);
  const ratio = update.ratio ?? (group.ratio as SocialRatio);
  const photoIds = update.photoIds ? Array.from(new Set(update.photoIds)) : group.photos.map((photo) => photo.submissionMediaId);
  const imagesChange = Boolean(update.photoIds && update.photoIds.join() !== group.photos.map((photo) => photo.submissionMediaId).join())
    || format !== group.format || ratio !== group.ratio
    || (update.splitLayout !== undefined && update.splitLayout !== group.splitLayout)
    || (update.frameText !== undefined && (update.frameText?.trim() || null) !== group.frameText);
  let photos: EligiblePhoto[] | null = null;
  if (imagesChange || update.regenerateCaptions) {
    const { eligible, refused } = await checkPhotos(photoIds, { ratio });
    if (refused.length) throw new GroupError(409, "Some photos cannot be used.", refused.map((item) => item.reason));
    validateShape(format, photoIds, eligible);
    photos = photoIds.map((id) => eligible.get(id)!);
  }
  const regenerated = update.regenerateCaptions && photos ? await defaultCaptions(format, photos, update.regenerateCaptions.templateKey, update.regenerateCaptions.hookIndex) : null;
  const staleKeys = await db.$transaction(async (tx) => {
    const moved = await tx.socialPostGroup.updateMany({ where: { id: groupId, revision: update.expectedRevision }, data: { revision: { increment: 1 } } });
    if (moved.count !== 1) throw new GroupError(409, "Someone else changed this draft since you opened it. Reload to see their changes; your text is kept on screen.");
    let keys: string[] = [];
    if (imagesChange && photos) {
      keys = await dropDerivatives(tx, groupId);
      const roles = rolesFor(format, photos);
      const previous = new Map(group.photos.map((photo) => [photo.submissionMediaId, photo]));
      await tx.socialPostGroupPhoto.deleteMany({ where: { groupId } });
      for (let order = 0; order < photos.length; order++) {
        const photo = photos[order];
        const earlier = previous.get(photo.photoId);
        await tx.socialPostGroupPhoto.create({ data: { groupId, submissionMediaId: photo.photoId, order, role: roles[order], altText: earlier?.altText ?? "", beforeCheckedAt: earlier?.beforeCheckedAt ?? null, beforeCheckedById: earlier?.beforeCheckedById ?? null } });
      }
      await tx.socialPostAsset.deleteMany({ where: { socialPost: { groupId } } });
    }
    await tx.socialPostGroup.update({
      where: { id: groupId },
      data: {
        ...(update.title !== undefined ? { title: update.title.trim().slice(0, 160) || group.title } : {}),
        format,
        ratio,
        splitLayout: format === "BEFORE_AFTER" ? (update.splitLayout !== undefined ? update.splitLayout : group.splitLayout) ?? "SIDE" : null,
        frameText: format === "FRAME" ? (update.frameText !== undefined ? update.frameText?.trim().slice(0, 32) || null : group.frameText) : null,
        ...(imagesChange ? { reviewedAt: null, reviewedById: null } : {}),
      },
    });
    for (const [photoId, text] of Object.entries(update.altText ?? {})) {
      await tx.socialPostGroupPhoto.updateMany({ where: { groupId, submissionMediaId: photoId }, data: { altText: text.trim().slice(0, 1000) } });
    }
    if (update.beforeChecked) {
      const now = new Date();
      await tx.socialPostGroupPhoto.updateMany({ where: { groupId, role: "BEFORE", submissionMediaId: { in: update.beforeChecked } }, data: { beforeCheckedAt: now, beforeCheckedById: actorId } });
      await tx.socialPostGroupPhoto.updateMany({ where: { groupId, role: "BEFORE", submissionMediaId: { notIn: update.beforeChecked } }, data: { beforeCheckedAt: null, beforeCheckedById: null } });
    }
    const captions: GroupCaptionInput = { ...(update.captions ?? {}) };
    if (regenerated) {
      for (const network of update.regenerateCaptions?.networks ?? SOCIAL_NETWORK_KEYS) captions[network] = regenerated[network];
    }
    for (const [network, value] of Object.entries(captions)) {
      if (!isSocialNetwork(network) || !value) continue;
      await tx.socialPost.updateMany({ where: { groupId, channel: network, status: { in: ["DRAFT", "FAILED", "SCHEDULED"] } }, data: { caption: value.caption.slice(0, 10000), ...(value.hashtags ? { hashtags: value.hashtags.slice(0, 30) } : {}) } });
    }
    return keys;
  });
  for (const key of staleKeys) await deleteDerivative(key);
}

/** "I looked at every photo": stored with the person and the time, for this revision. */
export async function markReviewed(groupId: string, actorId: string, expectedRevision: number, reviewed: boolean): Promise<void> {
  await requireDraft(groupId);
  const moved = await db.socialPostGroup.updateMany({ where: { id: groupId, revision: expectedRevision }, data: reviewed ? { reviewedAt: new Date(), reviewedById: actorId, revision: { increment: 1 } } : { reviewedAt: null, reviewedById: null, revision: { increment: 1 } } });
  if (moved.count !== 1) throw new GroupError(409, "The draft changed since you opened it. Look at the photos again, then tick.");
  if (reviewed) await db.auditLog.create({ data: { userId: actorId, action: "SOCIAL_PHOTOS_REVIEWED", entity: "SocialPostGroup", entityId: groupId } });
}

export async function cancelGroup(groupId: string, actorId: string): Promise<void> {
  const group = await requireDraft(groupId);
  const keys = await db.$transaction(async (tx) => {
    const dropped = await dropDerivatives(tx, groupId);
    await tx.socialPost.updateMany({ where: { groupId, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } }, data: { status: "CANCELLED" } });
    await tx.socialPostGroup.update({ where: { id: groupId }, data: { status: "CANCELLED", plannedFor: null } });
    await tx.auditLog.create({ data: { userId: actorId, action: "SOCIAL_DRAFT_CANCELLED", entity: "SocialPostGroup", entityId: group.id } });
    return dropped;
  });
  for (const key of keys) await deleteDerivative(key);
}

export type GroupImage = { assetId: string; s3Key: string; altText: string; width: number; height: number };

function altFor(photo: { altText: string }, field: ReturnType<typeof socialPhotoField>, role: "PHOTO" | "BEFORE" | "AFTER"): string {
  return photo.altText.trim() || (field ? suggestAltText(field.altHint, role) : "");
}

async function storeDerivative(groupId: string, derivative: Derivative, input: { kind: string; ratio: SocialRatio; photo: EligiblePhoto; second?: EligiblePhoto | null; actorId: string | null; label: string }): Promise<{ id: string; s3Key: string }> {
  const key = newDerivativeKey(groupId);
  await putDerivative(key, derivative.bytes);
  const asset = await db.marketingAsset.create({
    data: {
      name: `Social copy · ${input.label} · ${input.ratio}`,
      url: "",
      s3Key: key,
      mediaType: "IMAGE",
      width: derivative.width,
      height: derivative.height,
      tags: ["social", "cleaned-copy"],
      description: "Cleaned copy for a social post: stamp band and top strip cut off, camera and location data removed. The original evidence photo is unchanged.",
      uploadedById: input.actorId,
      derivativeKind: input.kind,
      sourceSubmissionMediaId: input.photo.photoId,
      sourceSecondMediaId: input.second?.photoId ?? null,
      sourceJobId: input.photo.jobId,
      sourcePropertyId: input.photo.propertyId,
      socialGroupId: groupId,
      ratio: input.ratio,
      sha256: derivative.sha256,
      exifStripped: true,
    },
  });
  await db.marketingAsset.update({ where: { id: asset.id }, data: { url: `/api/admin/marketing/social/derivatives/${asset.id}` } });
  return { id: asset.id, s3Key: key };
}

/**
 * The cleaned copies a post sends, in order, made now if they do not exist
 * for the current revision. Re-checks every photo first.
 */
export async function ensureDerivatives(groupId: string, actorId: string | null): Promise<GroupImage[]> {
  const group = await db.socialPostGroup.findUnique({ where: { id: groupId }, include: { photos: { orderBy: { order: "asc" } } } });
  if (!group) throw new GroupError(404, "This post no longer exists.");
  const ratio = group.ratio as SocialRatio;
  const { eligible, refused } = await checkPhotos(group.photos.map((photo) => photo.submissionMediaId), { ratio });
  if (refused.length) throw new GroupError(409, "Some photos cannot be used.", refused.map((item) => item.reason));
  const existing = await db.marketingAsset.findMany({ where: { socialGroupId: groupId }, orderBy: { createdAt: "asc" } });
  const photoRows = group.photos;
  const alt = (index: number) => {
    const row = photoRows[index];
    return altFor(row, socialPhotoField(eligible.get(row.submissionMediaId)!.field.fieldId), row.role as "PHOTO" | "BEFORE" | "AFTER");
  };
  if (existing.length) {
    const indexOf = (photoId: string | null) => Math.max(0, photoRows.findIndex((row) => row.submissionMediaId === photoId));
    return existing.map((asset) => {
      const combined = asset.sourceSecondMediaId ? `${alt(indexOf(asset.sourceSecondMediaId))} ${alt(indexOf(asset.sourceSubmissionMediaId))}`.trim() : alt(indexOf(asset.sourceSubmissionMediaId));
      return { assetId: asset.id, s3Key: asset.s3Key ?? "", altText: combined, width: asset.width ?? 0, height: asset.height ?? 0 };
    });
  }
  const photos = photoRows.map((row) => eligible.get(row.submissionMediaId)!);
  const bytes = await Promise.all(photos.map((photo) => readEvidencePhoto(photo.s3Key)));
  const images: GroupImage[] = [];
  const settings = await getAppSettings();
  if (group.format === "BEFORE_AFTER") {
    const beforeIndex = photoRows.findIndex((row) => row.role === "BEFORE");
    const afterIndex = beforeIndex === 0 ? 1 : 0;
    if (group.splitLayout === "SLIDES") {
      for (const [index, label] of [[beforeIndex, "Before"], [afterIndex, "After"]] as const) {
        const made = await makeLabelledCrop(bytes[index], ratio, label);
        const stored = await storeDerivative(groupId, made, { kind: "social_split", ratio, photo: photos[index], actorId, label });
        images.push({ assetId: stored.id, s3Key: stored.s3Key, altText: alt(index), width: made.width, height: made.height });
      }
    } else {
      const made = await makeBeforeAfterSplit(bytes[beforeIndex], bytes[afterIndex], ratio, group.splitLayout === "STACK" ? "STACK" : "SIDE");
      const stored = await storeDerivative(groupId, made, { kind: "social_split", ratio, photo: photos[afterIndex], second: photos[beforeIndex], actorId, label: "Before and after" });
      images.push({ assetId: stored.id, s3Key: stored.s3Key, altText: `${alt(beforeIndex)} ${alt(afterIndex)}`.trim(), width: made.width, height: made.height });
    }
    return images;
  }
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    const made = group.format === "FRAME"
      ? await makeFramedCrop(bytes[index], ratio, settings.companyName || "sNeek", group.frameText || "Guest-ready")
      : await makeSocialCrop(bytes[index], ratio);
    const stored = await storeDerivative(groupId, made, { kind: group.format === "FRAME" ? "social_frame" : "social_crop", ratio, photo, actorId, label: photo.field.room });
    images.push({ assetId: stored.id, s3Key: stored.s3Key, altText: alt(index), width: made.width, height: made.height });
  }
  return images;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function loadGroupView(groupId: string): Promise<GroupView | null> {
  const group = await db.socialPostGroup.findUnique({
    where: { id: groupId },
    include: { photos: { orderBy: { order: "asc" } }, posts: { include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } } } },
  });
  if (!group) return null;
  const ids = group.photos.map((photo) => photo.submissionMediaId);
  const [{ eligible, refused }, media, assets, reviewer] = await Promise.all([
    checkPhotos(ids, { ratio: group.ratio as SocialRatio }),
    db.submissionMedia.findMany({ where: { id: { in: ids } }, select: { id: true, fieldId: true, submission: { select: { job: { select: { jobNumber: true, property: { select: { name: true } } } } } } } }),
    db.marketingAsset.findMany({ where: { socialGroupId: groupId }, orderBy: { createdAt: "asc" } }),
    group.reviewedById ? db.user.findUnique({ where: { id: group.reviewedById }, select: { name: true, email: true } }) : null,
  ]);
  const mediaById = new Map(media.map((row) => [row.id, row]));
  const refusalById = new Map(refused.map((item) => [item.photoId, item.reason]));
  const order: SocialNetwork[] = [...SOCIAL_NETWORK_KEYS];
  const posts: NetworkPostView[] = group.posts
    .filter((post) => isSocialNetwork(post.channel))
    .sort((a, b) => order.indexOf(a.channel as SocialNetwork) - order.indexOf(b.channel as SocialNetwork))
    .map((post) => ({
      postId: post.id,
      network: post.channel as SocialNetwork,
      status: post.status,
      deliveryMode: (post.deliveryMode as "API" | "MANUAL" | null) ?? null,
      caption: post.caption,
      hashtags: post.hashtags,
      scheduledFor: iso(post.scheduledFor),
      publishedAt: iso(post.publishedAt),
      externalId: post.externalId,
      externalUrl: post.externalUrl,
      failureReason: post.failureReason,
      failureCode: post.failureCode,
      attemptCount: post.attemptCount,
      removalNeededAt: iso(post.removalNeededAt),
      removalDoneAt: iso(post.removalDoneAt),
      metrics: post.metrics[0] ? { fetchedAt: post.metrics[0].fetchedAt.toISOString(), reach: post.metrics[0].reach, likes: post.metrics[0].likes, comments: post.metrics[0].comments, shares: post.metrics[0].shares } : null,
    }));
  return {
    id: group.id,
    title: group.title,
    format: group.format as SocialFormat,
    status: group.status,
    createdVia: group.createdVia as "USER" | "AGENT",
    ratio: group.ratio as SocialRatio,
    splitLayout: (group.splitLayout as SplitLayout | null) ?? null,
    frameText: group.frameText,
    revision: group.revision,
    reviewedAt: iso(group.reviewedAt),
    reviewedByName: reviewer ? reviewer.name || reviewer.email || null : null,
    plannedFor: iso(group.plannedFor),
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    photos: group.photos.map((photo) => {
      const row = mediaById.get(photo.submissionMediaId);
      const field = socialPhotoField(row?.fieldId ?? "");
      const eligiblePhoto = eligible.get(photo.submissionMediaId);
      return {
        photoId: photo.submissionMediaId,
        order: photo.order,
        role: photo.role as "PHOTO" | "BEFORE" | "AFTER",
        altText: photo.altText,
        altHint: field ? suggestAltText(field.altHint, photo.role as "PHOTO" | "BEFORE" | "AFTER") : "",
        room: field?.room ?? "Photo",
        fieldLabel: field?.label ?? "",
        fieldKind: field?.kind ?? "FINAL",
        jobNumber: row?.submission.job.jobNumber ?? "",
        propertyName: eligiblePhoto?.propertyName ?? row?.submission.job.property.name ?? "",
        beforeCheckedAt: iso(photo.beforeCheckedAt),
        refusal: refusalById.get(photo.submissionMediaId) ?? null,
      };
    }),
    posts,
    derivatives: assets.map((asset) => ({ assetId: asset.id, kind: asset.derivativeKind ?? "", ratio: asset.ratio, width: asset.width, height: asset.height, sourcePhotoId: asset.sourceSubmissionMediaId })),
  };
}

export async function listGroups(limit = 50): Promise<Array<{ id: string; title: string; format: string; status: string; createdVia: string; createdAt: string; plannedFor: string | null; posts: Array<{ network: string; status: string; deliveryMode: string | null; externalUrl: string | null; externalId: string | null; scheduledFor: string | null; removalNeededAt: string | null; removalDoneAt: string | null; postId: string }> }>> {
  const groups = await db.socialPostGroup.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: limit, include: { posts: true } });
  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    format: group.format,
    status: group.status,
    createdVia: group.createdVia,
    createdAt: group.createdAt.toISOString(),
    plannedFor: iso(group.plannedFor),
    posts: group.posts.map((post) => ({ postId: post.id, network: post.channel, status: post.status, deliveryMode: post.deliveryMode, externalUrl: post.externalUrl, externalId: post.externalId, scheduledFor: iso(post.scheduledFor), removalNeededAt: iso(post.removalNeededAt), removalDoneAt: iso(post.removalDoneAt) })),
  }));
}
