import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
// Estate-native blog manager — same /api/admin/blog-posts endpoints as v1
// (GET list, POST create, PATCH/DELETE by id) rendered entirely with the
// Estate primitives + estate-kit. No dependency on components/{admin,ui,shared}.
import { BlogWorkspace } from "@/components/v2/admin/website/blog/blog-workspace";

export const metadata = { title: "Blog · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminBlogPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Website"
        title="Blog"
        description="Write, publish, and retire public blog posts — cover imagery, tags, SEO, and markdown content."
      />
      <BlogWorkspace />
    </div>
  );
}
