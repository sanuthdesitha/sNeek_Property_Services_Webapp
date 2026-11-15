import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { blogPostState } from "@/lib/public-site/blog-visibility";
import { formatOrgDateTime } from "@/lib/public-site/zoned-time";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";

export const metadata = { title: "Post preview · Blog · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Staff-only preview of a saved blog post in any state (draft, scheduled,
 * published). The public site never reads this route; public reads stay
 * filtered by lib/public-site/blog-visibility.
 */
export default async function BlogPostPreviewPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [post, settings] = await Promise.all([
    db.blogPost.findUnique({ where: { id: params.id } }).catch(() => null),
    getAppSettings(),
  ]);
  if (!post) notFound();
  const state = blogPostState(post);
  const status =
    state === "draft"
      ? "Draft: not on the public site."
      : state === "scheduled"
        ? `Scheduled: not on the public site until ${formatOrgDateTime(post.publishedAt, settings.timezone)}.`
        : `Published ${formatOrgDateTime(post.publishedAt ?? post.updatedAt, settings.timezone)}: this is what the public sees.`;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <EPageHeader
        eyebrow="Website · Blog · preview of the saved post"
        title={post.title}
        actions={
          <EButton asChild variant="ghost" size="sm">
            <Link href={`/v2/admin/website/blog?open=${post.id}`}>Back to the editor</Link>
          </EButton>
        }
      />
      <p role="status" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass(state === "published" ? "good" : "info")}`}>
        {status} Unsaved edits in the editor are not shown here.
      </p>
      {post.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.coverImageUrl} alt="" className="w-full rounded-[var(--e-radius-lg)] object-cover" />
      ) : null}
      <p className="text-[1.0625rem] text-[hsl(var(--e-text-secondary))]">{post.excerpt}</p>
      <article className="prose max-w-none text-[hsl(var(--e-foreground))] dark:prose-invert">
        <ReactMarkdown>{post.body}</ReactMarkdown>
      </article>
    </div>
  );
}
