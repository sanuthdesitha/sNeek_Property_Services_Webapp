import { db } from "@/lib/db";
import { canUseNodePrisma } from "@/lib/database-runtime";

export async function listPublishedBlogPosts() {
  if (!canUseNodePrisma()) return [];
  try {
    return await db.blogPost.findMany({
      where: { isPublished: true },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
    });
  } catch {
    return [];
  }
}

export async function getPublishedBlogPostBySlug(slug: string) {
  if (!canUseNodePrisma()) return null;
  try {
    return await db.blogPost.findFirst({ where: { slug, isPublished: true } });
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
