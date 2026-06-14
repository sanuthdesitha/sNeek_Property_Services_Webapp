import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { listPublishedBlogPosts } from "@/lib/public-site/blog";
import { getPublicWidgetFlags } from "@/lib/public-site/widgets";
import { WebsitePreviewClient } from "@/components/admin/website-preview-client";

// Always render fresh — this is the editor's live-preview surface and must
// reflect the latest saved content (and accept draft overrides at runtime).
export const dynamic = "force-dynamic";

/**
 * Live-preview surface for the public website editor. This renders the REAL
 * public home page (PublicSiteShell + HomePage) so admins see an exact replica
 * of the marketing site. The editor embeds this route in an iframe and pushes
 * draft content via postMessage so edits appear instantly before publishing.
 */
export default async function AdminWebsitePreviewPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const latestBlogPosts =
    settings.websiteContent.pageVisibility.blog !== false
      ? (await listPublishedBlogPosts()).slice(0, 3)
      : [];
  const widgetFlags = await getPublicWidgetFlags();

  // Serialize blog posts so the client component can hold them as plain JSON
  // (Date fields are converted to ISO strings on the wire).
  const serializedPosts = latestBlogPosts.map((post) => ({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverImageUrl: post.coverImageUrl ?? null,
    publishedAt: post.publishedAt ? new Date(post.publishedAt).toISOString() : null,
    authorName: post.authorName ?? null,
  }));

  return (
    <WebsitePreviewClient
      initialContent={settings.websiteContent}
      companyName={companyName}
      logoUrl={settings.logoUrl}
      latestBlogPosts={serializedPosts}
      widgetFlags={widgetFlags}
    />
  );
}
