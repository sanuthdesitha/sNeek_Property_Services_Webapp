/**
 * "Where this image is used" (board "Marketing", 2026-11-16).
 *
 * Looks for a library image's address in email campaigns, blog posts (cover,
 * gallery and wording), the website content, and the social posts it is
 * attached to. Shown before someone removes an image. A lookup that fails is
 * reported as unknown, never as "not used".
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export type ImageUseKind = "email_campaign" | "blog_post" | "website" | "social_post";

export type ImageUse = {
  kind: ImageUseKind;
  label: string;
  href: string;
};

export type ImageUsage = { status: "known"; uses: ImageUse[] } | { status: "unknown"; message: string };

/** Every content path in the website content whose value is exactly this address. */
export function websitePathsUsing(content: unknown, url: string, prefix = ""): string[] {
  if (typeof content === "string") return content.trim() === url ? [prefix] : [];
  if (Array.isArray(content)) return content.flatMap((item, index) => websitePathsUsing(item, url, `${prefix}[${index}]`));
  if (content && typeof content === "object") {
    return Object.entries(content as Record<string, unknown>).flatMap(([key, value]) => websitePathsUsing(value, url, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

export async function findImageUsage(assetId: string): Promise<ImageUsage> {
  try {
    const asset = await db.marketingAsset.findUnique({ where: { id: assetId }, select: { id: true, url: true } });
    if (!asset) return { status: "unknown", message: "This image is no longer in the library." };
    const url = asset.url.trim();
    const [campaigns, posts, socialLinks, settings] = await Promise.all([
      db.emailCampaign.findMany({ where: { htmlBody: { contains: url } }, select: { id: true, name: true }, take: 50 }),
      db.blogPost.findMany({
        where: { OR: [{ coverImageUrl: url }, { galleryImageUrls: { has: url } }, { body: { contains: url } }] },
        select: { id: true, title: true },
        take: 50,
      }),
      db.socialPostAsset.findMany({ where: { assetId }, select: { socialPost: { select: { id: true, channel: true, caption: true } } }, take: 50 }),
      getAppSettings(),
    ]);
    const uses: ImageUse[] = [
      ...campaigns.map((row) => ({ kind: "email_campaign" as const, label: `Email campaign: ${row.name}`, href: `/v2/admin/marketing?tab=email&open=${row.id}` })),
      ...posts.map((row) => ({ kind: "blog_post" as const, label: `Blog post: ${row.title}`, href: `/v2/admin/website/blog?open=${row.id}` })),
      ...socialLinks.map(({ socialPost }) => ({
        kind: "social_post" as const,
        label: `Social post (${String(socialPost.channel).toLowerCase()}): ${socialPost.caption.slice(0, 50)}`,
        href: "/v2/admin/marketing?tab=social",
      })),
    ];
    if (websitePathsUsing(settings.websiteContent, url).length > 0) {
      uses.push({ kind: "website", label: "Website pages", href: "/v2/admin/website" });
    }
    return { status: "known", uses };
  } catch {
    return { status: "unknown", message: "Where this image is used could not be checked." };
  }
}
