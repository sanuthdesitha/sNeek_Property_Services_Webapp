/**
 * Social channel publishing stubs.
 *
 * Full OAuth flows + per-platform SDKs are deferred to per-channel follow-up
 * sessions:
 *   - FACEBOOK / INSTAGRAM → Meta Graph API
 *   - YOUTUBE              → YouTube Data API v3
 *   - TIKTOK               → TikTok for Developers Marketing API
 *
 * For now we expose two operations:
 *   publishSocialPost — marks a draft as SCHEDULED (no real network call)
 *   markAsPublished   — admin pastes back the real URL after manually posting
 */
import { db } from "@/lib/db";

export type SocialChannelValue = "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK";

export interface PublishResult {
  ok: boolean;
  externalId?: string;
  externalUrl?: string;
  error?: string;
  note?: string;
}

/**
 * STUB: publish a draft SocialPost to its channel. No real API call is made.
 * The post is marked SCHEDULED and the admin must complete the manual publish
 * + paste the URL back via markAsPublished().
 */
export async function publishSocialPost(postId: string): Promise<PublishResult> {
  const post = await (db as any).socialPost.findUnique({
    where: { id: postId },
    include: { assets: { include: { asset: true } } },
  });
  if (!post) return { ok: false, error: "Post not found" };

  await (db as any).socialPost.update({
    where: { id: postId },
    data: { status: "SCHEDULED" },
  });

  return {
    ok: true,
    externalId: "stub-pending",
    note:
      "Stub: manual publish needed. Full OAuth integration for " +
      post.channel +
      " is a follow-up session per platform.",
  };
}

/**
 * Admin marks a post as published manually with the real URL/ID.
 */
export async function markAsPublished(
  postId: string,
  externalUrl: string,
  externalId?: string,
): Promise<void> {
  await (db as any).socialPost.update({
    where: { id: postId },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      externalUrl,
      externalId,
    },
  });
}
