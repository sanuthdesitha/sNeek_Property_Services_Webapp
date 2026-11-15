import "server-only";
import { db } from "@/lib/db";
import { usableAccount } from "./accounts";
import { META_GRAPH } from "./networks/meta";
import { realHttpClient, type HttpClient } from "./networks/http";

/**
 * Reach and reactions (2026-11-17), read once a day for posts sNeek
 * published through the API, from 24 hours to 7 days after posting, and only
 * when the network answers. A figure the network did not return is stored
 * as null and shown "not recorded", never as 0.
 */

function numberAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function insightValue(json: unknown, metric: string): number | null {
  const data = (json as { data?: Array<{ name?: unknown; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> } | null)?.data;
  const row = data?.find((item) => item.name === metric);
  return numberAt(row?.total_value?.value ?? row?.values?.[0]?.value);
}

async function readFacebook(http: HttpClient, token: string, postId: string) {
  const id = encodeURIComponent(postId);
  const [summary, insights] = await Promise.all([
    http({ method: "GET", url: `${META_GRAPH}/${id}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares`, bearer: token }).catch(() => null),
    http({ method: "GET", url: `${META_GRAPH}/${id}/insights?metric=post_impressions_unique`, bearer: token }).catch(() => null),
  ]);
  const body = (summary?.status === 200 ? summary.json : null) as { reactions?: { summary?: { total_count?: unknown } }; comments?: { summary?: { total_count?: unknown } }; shares?: { count?: unknown } } | null;
  return {
    reach: insights?.status === 200 ? insightValue(insights.json, "post_impressions_unique") : null,
    likes: numberAt(body?.reactions?.summary?.total_count),
    comments: numberAt(body?.comments?.summary?.total_count),
    shares: numberAt(body?.shares?.count),
  };
}

async function readInstagram(http: HttpClient, token: string, mediaId: string) {
  const response = await http({ method: "GET", url: `${META_GRAPH}/${encodeURIComponent(mediaId)}/insights?metric=reach,likes,comments,shares`, bearer: token }).catch(() => null);
  const json = response?.status === 200 ? response.json : null;
  return { reach: insightValue(json, "reach"), likes: insightValue(json, "likes"), comments: insightValue(json, "comments"), shares: insightValue(json, "shares") };
}

export async function collectSocialInsights(input: { http?: HttpClient; now?: Date } = {}): Promise<{ read: number; skipped: number }> {
  const now = input.now ?? new Date();
  const http = input.http ?? realHttpClient;
  const posts = await db.socialPost.findMany({
    where: {
      status: "PUBLISHED",
      deliveryMode: "API",
      externalId: { not: null },
      channel: { in: ["FACEBOOK", "INSTAGRAM"] },
      publishedAt: { lte: new Date(now.getTime() - 86_400_000), gte: new Date(now.getTime() - 7 * 86_400_000) },
    },
    select: { id: true, channel: true, externalId: true, metrics: { orderBy: { fetchedAt: "desc" }, take: 1, select: { fetchedAt: true } } },
    take: 100,
  });
  let read = 0;
  let skipped = 0;
  const accounts = new Map<string, Awaited<ReturnType<typeof usableAccount>>>();
  for (const post of posts) {
    if (post.metrics[0] && now.getTime() - post.metrics[0].fetchedAt.getTime() < 20 * 3_600_000) {
      skipped += 1;
      continue;
    }
    if (!accounts.has(post.channel)) accounts.set(post.channel, await usableAccount(post.channel as "FACEBOOK" | "INSTAGRAM", http, now));
    const account = accounts.get(post.channel);
    if (!account) {
      skipped += 1;
      continue;
    }
    const figures = post.channel === "FACEBOOK" ? await readFacebook(http, account.token, post.externalId!) : await readInstagram(http, account.token, post.externalId!);
    await db.socialPostMetric.create({ data: { socialPostId: post.id, fetchedAt: now, ...figures } });
    read += 1;
  }
  return { read, skipped };
}
