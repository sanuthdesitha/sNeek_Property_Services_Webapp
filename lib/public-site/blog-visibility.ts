/**
 * When a blog post is public (2026-11-16, board "Website and blog").
 *
 * A post is public only when it is published AND its publish time has arrived.
 * A published post with a future publish time is "scheduled": hidden from every
 * public read (blog list, post page, home page latest posts, sitemap, Growth
 * count) until that instant. No worker flips anything: every public read
 * filters by the time of the request, and the public blog routes render per
 * request (force-dynamic, no generateStaticParams), so nothing cached can show a
 * scheduled post early or hide it once its time has come.
 *
 * Published rows saved before scheduling existed always carry a publish time
 * (the API stamps "now" on publish). A published row without one stays public,
 * exactly as it was before this change.
 *
 * Plain module: safe for server pages, API routes and client components.
 */

export type BlogPostState = "draft" | "scheduled" | "published";

export type BlogVisibilityFields = {
  isPublished: boolean;
  publishedAt?: Date | string | null;
};

/** Prisma `where` for every public blog read. */
export function publicBlogWhere(now: Date = new Date()) {
  return {
    isPublished: true,
    OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
  };
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function blogPostState(post: BlogVisibilityFields, now: Date = new Date()): BlogPostState {
  if (!post.isPublished) return "draft";
  const at = toTime(post.publishedAt);
  if (at !== null && at > now.getTime()) return "scheduled";
  return "published";
}

export function isBlogPostPublic(post: BlogVisibilityFields, now: Date = new Date()): boolean {
  return blogPostState(post, now) === "published";
}

export const BLOG_STATE_LABEL: Record<BlogPostState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
};
