import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { socialRightRefusal } from "./access";
import { accountNeedsReconnect, usableAccount, type UsableAccount } from "./accounts";
import { captionProblems, finalCaption } from "./captions";
import { lintAgainstAll, type ForbiddenFacts } from "./caption-linter";
import { checkPhotos } from "./eligibility";
import { ensureDerivatives, GroupError, POSTED_STATUSES, type GroupImage } from "./groups";
import { networkDefinition, type SocialNetwork, type SocialRatio } from "./networks";
import { publishToFacebookPage, publishToInstagram, type PublishImage, type PublishOutcome } from "./networks/meta";
import { realHttpClient, type HttpClient } from "./networks/http";
import { publicMediaBase, publicMediaUrl, signMediaToken } from "./public-media";
import type { PublishResultRow } from "./view-types";

/**
 * Posting (2026-11-17). Only on a person's click (tier A confirmation naming
 * every destination) or at a time a person planned; agents and AI never post.
 *
 * Before anything is sent, the server checks again: the person's right
 * (live), the "I looked at every photo" tick for this revision, every
 * photo's eligibility and permission, the before-photo ticks, alt text on
 * every image, each network's caption limits and the caption linter. Any
 * problem refuses the whole post and nothing is sent.
 *
 * One attempt per post and network: the network row is claimed with a
 * conditional update (DRAFT/SCHEDULED → SENDING, or FAILED → SENDING for a
 * retry) and the attempt is numbered with a unique (post, attempt) row, so a
 * double click, a second tab or an overlapping planned run cannot post twice.
 * A row becomes PUBLISHED only when the network returns the post id; a
 * timeout after sending is UNCONFIRMED ("check before retrying"); a refusal
 * is FAILED with the network's reason. Results are recorded per network
 * exactly as the network answered.
 */

export class PublishRefused extends Error {
  constructor(public problems: string[]) {
    super(problems[0] ?? "This post cannot be posted.");
    this.name = "PublishRefused";
  }
}

export type PublishTrigger = "CLICK" | "SCHEDULE" | "RETRY";

export type PublishDeps = {
  http?: HttpClient;
  now?: Date;
  /** Tests: the public https address networks fetch images from. */
  publicBase?: string;
  sleep?: (ms: number) => Promise<void>;
};

type GroupRow = Prisma.SocialPostGroupGetPayload<{ include: { photos: { orderBy: { order: "asc" } }; posts: true } }>;

async function loadGroup(groupId: string): Promise<GroupRow> {
  const group = await db.socialPostGroup.findUnique({ where: { id: groupId }, include: { photos: { orderBy: { order: "asc" } }, posts: true } });
  if (!group) throw new PublishRefused(["This post no longer exists. Its permission may have been revoked."]);
  if (group.status === "CANCELLED") throw new PublishRefused(["This post was cancelled."]);
  return group;
}

/** Every check that must pass before any network is contacted. Returns the problems in words. */
export async function prePublishProblems(group: GroupRow, networks: SocialNetwork[], actorId: string, now: Date): Promise<string[]> {
  const problems: string[] = [];
  const right = await socialRightRefusal(actorId, "post");
  if (right) problems.push(right);
  if (!group.reviewedAt) problems.push("Tick \"I looked at every photo\" first. sNeek cannot detect faces, belongings, mail or screens.");
  const { eligible, refused } = await checkPhotos(group.photos.map((photo) => photo.submissionMediaId), { ratio: group.ratio as SocialRatio, now });
  for (const item of refused) problems.push(`A photo can no longer be used: ${item.reason}`);
  for (const photo of group.photos) {
    if (photo.role === "BEFORE" && !photo.beforeCheckedAt) problems.push("Tick \"I checked the before photo\" first.");
    if (photo.role === "BEFORE" && eligible.get(photo.submissionMediaId) && !eligible.get(photo.submissionMediaId)!.consent.allowBefore) problems.push("The owner's permission does not cover before photos.");
    if (!photo.altText.trim()) problems.push("Write alt text for every photo; posting waits for it.");
  }
  const forbidden: ForbiddenFacts[] = Array.from(eligible.values()).map((photo) => photo.forbidden);
  for (const photo of group.photos) problems.push(...lintAgainstAll(photo.altText, forbidden, "Alt text"));
  if (group.frameText) problems.push(...lintAgainstAll(group.frameText, forbidden, "The frame text"));
  for (const network of networks) {
    const post = group.posts.find((row) => row.channel === network);
    if (!post) {
      problems.push(`${networkDefinition(network).label}: no caption row.`);
      continue;
    }
    problems.push(...captionProblems(network, post.caption, post.hashtags));
    problems.push(...lintAgainstAll(finalCaption(network, post.caption, post.hashtags), forbidden, `The ${networkDefinition(network).label} caption`));
  }
  return Array.from(new Set(problems));
}

async function audit(actorId: string, action: string, postId: string, after: Record<string, unknown>) {
  await db.auditLog.create({ data: { userId: actorId, action, entity: "SocialPost", entityId: postId, after: after as Prisma.InputJsonValue } }).catch((error) => {
    logger.error({ err: error instanceof Error ? error.message : "unknown" }, "[social] audit write failed");
  });
}

async function linkAssets(postId: string, images: GroupImage[], network: SocialNetwork) {
  const limit = networkDefinition(network).maxImages;
  await db.socialPostAsset.deleteMany({ where: { socialPostId: postId } });
  const chosen = images.slice(0, limit);
  for (let order = 0; order < chosen.length; order++) {
    await db.socialPostAsset.create({ data: { socialPostId: postId, assetId: chosen[order].assetId, order, altText: chosen[order].altText } });
  }
}

async function sendToNetwork(network: SocialNetwork, account: UsableAccount, caption: string, images: PublishImage[], deps: PublishDeps): Promise<PublishOutcome> {
  const http = deps.http ?? realHttpClient;
  if (network === "FACEBOOK") return publishToFacebookPage({ http, sleep: deps.sleep }, { pageId: account.externalId, token: account.token, caption, images });
  if (network === "INSTAGRAM") return publishToInstagram({ http, sleep: deps.sleep }, { igUserId: account.externalId, token: account.token, caption, images });
  return { kind: "failed", code: "NOT_SUPPORTED", reconnect: false, reason: `${networkDefinition(network).label} cannot be posted to from sNeek yet.` };
}

const CLAIMABLE: Record<PublishTrigger, readonly string[]> = {
  CLICK: ["DRAFT", "SCHEDULED"],
  SCHEDULE: ["SCHEDULED"],
  RETRY: ["FAILED"],
};

/** Claims one network row for one attempt. Null when another request already has it. */
async function claim(postId: string, trigger: PublishTrigger, allowUnconfirmed: boolean, accountId: string, actorId: string | null): Promise<number | null> {
  const statuses = [...CLAIMABLE[trigger], ...(trigger === "RETRY" && allowUnconfirmed ? ["UNCONFIRMED"] : [])];
  return db.$transaction(async (tx) => {
    const moved = await tx.socialPost.updateMany({
      where: { id: postId, status: { in: statuses as Prisma.EnumSocialPostStatusFilter["in"] } },
      data: { status: "SENDING", deliveryMode: "API", socialAccountId: accountId, attemptCount: { increment: 1 }, failureReason: null, failureCode: null },
    });
    if (moved.count !== 1) return null;
    const row = await tx.socialPost.findUniqueOrThrow({ where: { id: postId }, select: { attemptCount: true } });
    await tx.socialPublishAttempt.create({ data: { socialPostId: postId, attempt: row.attemptCount, trigger, actorId } });
    return row.attemptCount;
  });
}

async function settle(postId: string, attempt: number, outcome: PublishOutcome, now: Date): Promise<void> {
  const finishedAt = new Date();
  if (outcome.kind === "posted") {
    await db.socialPost.update({ where: { id: postId }, data: { status: "PUBLISHED", externalId: outcome.externalId, externalUrl: outcome.externalUrl, publishedAt: now, networkResponse: { id: outcome.externalId, permalink: outcome.externalUrl } } });
    await db.socialPublishAttempt.update({ where: { socialPostId_attempt: { socialPostId: postId, attempt } }, data: { finishedAt, outcome: "POSTED", externalId: outcome.externalId, externalUrl: outcome.externalUrl } });
    return;
  }
  if (outcome.kind === "unconfirmed") {
    await db.socialPost.update({ where: { id: postId }, data: { status: "UNCONFIRMED", failureReason: outcome.reason, failureCode: "UNCONFIRMED" } });
    await db.socialPublishAttempt.update({ where: { socialPostId_attempt: { socialPostId: postId, attempt } }, data: { finishedAt, outcome: "UNCONFIRMED", reason: outcome.reason } });
    return;
  }
  await db.socialPost.update({ where: { id: postId }, data: { status: "FAILED", failureReason: outcome.reason, failureCode: outcome.code } });
  await db.socialPublishAttempt.update({ where: { socialPostId_attempt: { socialPostId: postId, attempt } }, data: { finishedAt, outcome: "FAILED", errorCode: outcome.code, reason: outcome.reason } });
}

function resultMessage(network: SocialNetwork, outcome: PublishOutcome): string {
  const label = networkDefinition(network).label;
  if (outcome.kind === "posted") return `${label} confirmed post ${outcome.externalId.slice(0, 12)}${outcome.externalId.length > 12 ? "…" : ""}.`;
  return outcome.reason;
}

/**
 * Sends a group to the chosen networks. Unconnected networks are reported
 * "not connected" (their row becomes a manual post for the fallback) and
 * nothing is sent to them. Returns one row per network as each answered.
 */
export async function publishGroup(input: { groupId: string; networks: SocialNetwork[]; actorId: string; trigger: PublishTrigger; confirmNotPosted?: boolean }, deps: PublishDeps = {}): Promise<PublishResultRow[]> {
  const now = deps.now ?? new Date();
  const http = deps.http ?? realHttpClient;
  const networks = Array.from(new Set(input.networks));
  if (networks.length === 0) throw new PublishRefused(["Choose at least one network."]);
  const group = await loadGroup(input.groupId);
  const problems = await prePublishProblems(group, networks, input.actorId, now);
  if (problems.length) throw new PublishRefused(problems);

  const base = deps.publicBase ? { base: deps.publicBase } : publicMediaBase();
  const results: PublishResultRow[] = [];
  const accounts = new Map<SocialNetwork, UsableAccount | null>();
  for (const network of networks) {
    accounts.set(network, networkDefinition(network).apiState === "api" ? await usableAccount(network, http, now) : null);
  }
  const sendable = networks.filter((network) => accounts.get(network));
  if (sendable.length && "problem" in base) throw new PublishRefused([base.problem]);

  // The cleaned copies: sent to connected networks, downloaded for the others.
  let images: GroupImage[];
  try {
    images = await ensureDerivatives(group.id, input.actorId);
  } catch (error) {
    if (error instanceof GroupError) throw new PublishRefused([error.message, ...error.details]);
    throw new PublishRefused(["The cleaned copies could not be made. Nothing was posted."]);
  }

  for (const network of networks) {
    const post = group.posts.find((row) => row.channel === network)!;
    await linkAssets(post.id, images, network);
    const account = accounts.get(network);
    if (!account) {
      if (!(POSTED_STATUSES as readonly string[]).includes(post.status) && post.status !== "PUBLISHED") {
        await db.socialPost.updateMany({ where: { id: post.id, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { deliveryMode: "MANUAL" } });
      }
      const definition = networkDefinition(network);
      results.push({ network, outcome: "NOT_CONNECTED", message: definition.apiState === "api" ? `${definition.label} is not connected. Use Download images + copy caption, then paste the link.` : `${definition.whyNot ?? "Not connected."} Use Download images + copy caption, then paste the link.`, externalUrl: null });
      continue;
    }
    const attempt = await claim(post.id, input.trigger, Boolean(input.confirmNotPosted), account.id, input.actorId);
    if (attempt === null) {
      results.push({ network, outcome: "ALREADY", message: `${networkDefinition(network).label}: already sent or being sent. Nothing was sent again.`, externalUrl: null });
      continue;
    }
    const caption = finalCaption(network, post.caption, post.hashtags);
    const signed = "base" in base
      ? images.slice(0, networkDefinition(network).maxImages).map((image) => ({ url: publicMediaUrl(base.base, signMediaToken({ assetId: image.assetId, groupId: group.id, now })), altText: image.altText }))
      : [];
    let outcome: PublishOutcome;
    try {
      outcome = await sendToNetwork(network, account, caption, signed, { ...deps, http });
    } catch {
      outcome = { kind: "unconfirmed", reason: `Not confirmed: something went wrong after sNeek started sending to ${networkDefinition(network).label}. Check it before retrying.` };
    }
    await settle(post.id, attempt, outcome, now);
    if (outcome.kind === "failed" && outcome.reconnect) await accountNeedsReconnect(account.id, outcome.reason);
    await audit(input.actorId, outcome.kind === "posted" ? "SOCIAL_POST_PUBLISHED" : outcome.kind === "unconfirmed" ? "SOCIAL_POST_UNCONFIRMED" : "SOCIAL_POST_FAILED", post.id, {
      network, trigger: input.trigger, attempt, groupId: group.id, account: account.displayName,
      externalId: outcome.kind === "posted" ? outcome.externalId : null, code: outcome.kind === "failed" ? outcome.code : null,
    });
    results.push({ network, outcome: outcome.kind === "posted" ? "POSTED" : outcome.kind === "unconfirmed" ? "UNCONFIRMED" : "FAILED", message: resultMessage(network, outcome), externalUrl: outcome.kind === "posted" ? outcome.externalUrl : null });
  }
  if (results.some((row) => row.outcome === "POSTED")) {
    await db.socialPostGroup.update({ where: { id: group.id }, data: { status: "POSTED" } });
  }
  return results;
}

/**
 * Plans the post for a time. Connected networks are posted by sNeek at that
 * time (re-checked then); the others wait for the person's link.
 */
export async function planGroup(input: { groupId: string; plannedFor: Date; networks: SocialNetwork[]; actorId: string }, deps: PublishDeps = {}): Promise<Array<{ network: SocialNetwork; mode: "API" | "MANUAL" }>> {
  const now = deps.now ?? new Date();
  if (input.plannedFor.getTime() <= now.getTime() + 60_000) throw new PublishRefused(["Choose a time at least a minute from now."]);
  if (input.plannedFor.getTime() > now.getTime() + 60 * 86_400_000) throw new PublishRefused(["Choose a time within 60 days."]);
  const group = await loadGroup(input.groupId);
  const networks = Array.from(new Set(input.networks));
  const problems = await prePublishProblems(group, networks, input.actorId, now);
  if (problems.length) throw new PublishRefused(problems);
  const plan: Array<{ network: SocialNetwork; mode: "API" | "MANUAL" }> = [];
  for (const network of networks) {
    const connected = networkDefinition(network).apiState === "api" && Boolean(await db.socialAccount.findFirst({ where: { network, status: "CONNECTED" }, select: { id: true } }));
    plan.push({ network, mode: connected ? "API" : "MANUAL" });
  }
  await db.$transaction(async (tx) => {
    for (const item of plan) {
      await tx.socialPost.updateMany({ where: { groupId: group.id, channel: item.network, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } }, data: { status: "SCHEDULED", scheduledFor: input.plannedFor, deliveryMode: item.mode } });
    }
    await tx.socialPostGroup.update({ where: { id: group.id }, data: { plannedFor: input.plannedFor, plannedById: input.actorId, status: "SCHEDULED" } });
    await tx.auditLog.create({ data: { userId: input.actorId, action: "SOCIAL_POST_PLANNED", entity: "SocialPostGroup", entityId: group.id, after: { plannedFor: input.plannedFor.toISOString(), plan } as Prisma.InputJsonValue } });
  });
  return plan;
}

export async function unplanGroup(groupId: string, actorId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.socialPost.updateMany({ where: { groupId, status: "SCHEDULED" }, data: { status: "DRAFT", scheduledFor: null } });
    await tx.socialPostGroup.updateMany({ where: { id: groupId, status: "SCHEDULED" }, data: { plannedFor: null, plannedById: null, status: "DRAFT" } });
    await tx.auditLog.create({ data: { userId: actorId, action: "SOCIAL_POST_UNPLANNED", entity: "SocialPostGroup", entityId: groupId } });
  });
}

/** "Posted by you": the person pasted the link of a post they made themselves. */
export async function recordManualPost(input: { postId: string; url: string; actorId: string; now?: Date }): Promise<void> {
  let valid = false;
  try {
    valid = new URL(input.url).protocol === "https:";
  } catch {
    valid = false;
  }
  if (!valid) throw new PublishRefused(["Paste the full link to the post, starting with https://"]);
  const moved = await db.socialPost.updateMany({
    where: { id: input.postId, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } },
    data: { status: "PUBLISHED", deliveryMode: "MANUAL", externalUrl: input.url, publishedAt: input.now ?? new Date() },
  });
  if (moved.count !== 1) throw new PublishRefused(["This network was already posted or is being sent."]);
  await audit(input.actorId, "SOCIAL_POST_LINK_RECORDED", input.postId, { url: input.url });
}
