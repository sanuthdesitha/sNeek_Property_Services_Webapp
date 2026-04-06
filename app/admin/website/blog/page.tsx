import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listAllBlogPosts } from "@/lib/public-site/blog";
import { BlogManager } from "@/components/admin/blog-manager";

export default async function AdminBlogPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const posts = await listAllBlogPosts();
  return <BlogManager initialPosts={posts} />;
}
