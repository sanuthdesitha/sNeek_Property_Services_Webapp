import { db } from "@/lib/db";
import { canUseNodePrisma } from "@/lib/database-runtime";
import { publicBlogWhere } from "@/lib/public-site/blog-visibility";

/** Public: published posts whose publish time has arrived (scheduled posts stay hidden). */
export async function listPublishedBlogPosts(now: Date = new Date()) {
  if (!canUseNodePrisma()) return [];
  try {
    return await db.blogPost.findMany({
      where: publicBlogWhere(now),
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
    });
  } catch {
    return [];
  }
}

/** Public: one post by its address, only once it is public. */
export async function getPublishedBlogPostBySlug(slug: string, now: Date = new Date()) {
  if (!canUseNodePrisma()) return null;
  try {
    return await db.blogPost.findFirst({ where: { slug, ...publicBlogWhere(now) } });
  } catch {
    return null;
  }
}

export async function listAllBlogPosts() {
  if (!canUseNodePrisma()) return [];
  try {
    return await db.blogPost.findMany({ orderBy: [{ updatedAt: "desc" }] });
  } catch {
    return [];
  }
}
