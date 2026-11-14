import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { countBlogPosts, findWebsitePublication, publishedLine } from "@/lib/public-site/website-publish";
import { WebsiteHeader } from "@/components/v2/admin/website/website-header";
import { BlogWorkspace } from "@/components/v2/admin/website/blog/blog-workspace";

export const metadata = { title: "Blog · Website · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Website › Blog (board "Website and blog", 2026-11-16): list on the left, the
 * post opens beside it. ADMIN and OPS_MANAGER publish posts, as before; the
 * /api/admin/blog-posts routes keep their guards.
 */
export default async function V2AdminBlogPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const [publication, blogCount] = await Promise.all([findWebsitePublication(settings.websiteContent), countBlogPosts()]);
  return (
    <div className="space-y-5">
      <WebsiteHeader active="blog" publishedLine={publishedLine(publication, settings.timezone)} blogCount={blogCount} />
      <BlogWorkspace timeZone={settings.timezone} />
    </div>
  );
}
