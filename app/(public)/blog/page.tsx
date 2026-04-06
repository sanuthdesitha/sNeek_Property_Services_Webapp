import { BlogIndexPage } from "@/components/public/blog-page";
import { listPublishedBlogPosts } from "@/lib/public-site/blog";
import { getAppSettings } from "@/lib/settings";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export const dynamic = "force-dynamic";

export default async function PublicBlogPage() {
  const [posts, settings] = await Promise.all([listPublishedBlogPosts(), getAppSettings()]);
  requireWebsitePageEnabled(settings.websiteContent, "blog");
  return <BlogIndexPage posts={posts} />;
}
