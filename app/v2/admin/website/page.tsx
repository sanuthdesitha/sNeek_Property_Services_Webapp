import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { countBlogPosts, findWebsitePublication, publishedLine, websiteContentRevision } from "@/lib/public-site/website-publish";
import { WebsiteHeader } from "@/components/v2/admin/website/website-header";
import { WebsiteCmsEditor, type LibraryImage } from "@/components/v2/admin/website/editor/website-editor";

export const metadata = { title: "Website · Estate admin" };
export const dynamic = "force-dynamic";

async function loadLibraryImages(): Promise<LibraryImage[]> {
  try {
    const rows = await db.marketingAsset.findMany({
      where: { mediaType: "IMAGE" },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      select: { id: true, name: true, url: true },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, url: row.url }));
  } catch {
    return [];
  }
}

/**
 * Website › Pages (board "Website and blog", 2026-11-16). The three-pane
 * editor works on a draft with a live preview; "Save and publish" goes through
 * PATCH /api/admin/settings, which requires ADMIN, refuses missing alt text and
 * refuses a stale draft. OPS_MANAGER sees it read-only, as before.
 */
export default async function V2AdminWebsitePage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const settings = await getAppSettings();
  const [publication, blogCount, images] = await Promise.all([
    findWebsitePublication(settings.websiteContent),
    countBlogPosts(),
    loadLibraryImages(),
  ]);

  return (
    <div className="space-y-5">
      <WebsiteHeader active="pages" publishedLine={publishedLine(publication, settings.timezone)} blogCount={blogCount} />
      <WebsiteCmsEditor
        initialContent={settings.websiteContent}
        initialRevision={websiteContentRevision(settings.websiteContent)}
        readOnly={!isAdmin}
        draftOwnerId={session.user.id}
        libraryImages={images}
        timeZone={settings.timezone}
      />
    </div>
  );
}
