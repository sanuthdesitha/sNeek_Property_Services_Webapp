// @vitest-environment node
/**
 * Scheduled blog posts (board "Website and blog", 2026-11-16): a published post
 * with a future publish time is not public until then, on EVERY public read,
 * and no public blog route is prerendered or cached past that time.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { blogPost: { findMany: m.findMany, findFirst: m.findFirst, count: m.count } } }));
vi.mock("@/lib/database-runtime", () => ({ canUseNodePrisma: () => true }));

import { BLOG_STATE_LABEL, blogPostState, isBlogPostPublic, publicBlogWhere } from "@/lib/public-site/blog-visibility";
import { getPublishedBlogPostBySlug, listPublishedBlogPosts } from "@/lib/public-site/blog";

const NOW = new Date("2026-11-14T10:00:00Z");
const ROOT = join(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** In-memory evaluation of the public `where`, the way PostgreSQL applies it. */
function matches(post: { isPublished: boolean; publishedAt: Date | null }, now: Date) {
  const where = publicBlogWhere(now);
  if (post.isPublished !== where.isPublished) return false;
  return where.OR.some((clause) => ("publishedAt" in clause && clause.publishedAt === null ? post.publishedAt === null : post.publishedAt !== null && post.publishedAt.getTime() <= (clause.publishedAt as { lte: Date }).lte.getTime()));
}

beforeEach(() => vi.clearAllMocks());

describe("blog post state", () => {
  it("draft, scheduled and published are told apart by the publish time", () => {
    expect(blogPostState({ isPublished: false, publishedAt: "2026-11-01T00:00:00Z" }, NOW)).toBe("draft");
    expect(blogPostState({ isPublished: true, publishedAt: "2026-12-01T07:00:00Z" }, NOW)).toBe("scheduled");
    expect(blogPostState({ isPublished: true, publishedAt: "2026-11-14T09:59:59Z" }, NOW)).toBe("published");
    expect(blogPostState({ isPublished: true, publishedAt: null }, NOW)).toBe("published");
    expect(BLOG_STATE_LABEL.scheduled).toBe("Scheduled");
  });

  it("a scheduled post becomes public exactly at its time, with no worker", () => {
    const post = { isPublished: true, publishedAt: new Date("2026-11-14T10:05:00Z") };
    expect(isBlogPostPublic(post, NOW)).toBe(false);
    expect(matches(post, NOW)).toBe(false);
    const later = new Date("2026-11-14T10:05:00Z");
    expect(isBlogPostPublic(post, later)).toBe(true);
    expect(matches(post, later)).toBe(true);
    expect(matches({ isPublished: false, publishedAt: new Date("2026-01-01") }, later)).toBe(false);
  });
});

describe("every public read filters by the request time", () => {
  it("the blog list and post page query only public posts", async () => {
    m.findMany.mockResolvedValue([]);
    m.findFirst.mockResolvedValue(null);
    await listPublishedBlogPosts(NOW);
    await getPublishedBlogPostBySlug("summer-checklist", NOW);
    expect(m.findMany.mock.calls[0][0].where).toEqual(publicBlogWhere(NOW));
    expect(m.findFirst.mock.calls[0][0].where).toEqual({ slug: "summer-checklist", ...publicBlogWhere(NOW) });
  });

  it("the sitemap, the Growth count and every page that lists posts use the public filter", () => {
    expect(read("app/sitemap.ts")).toMatch(/where: publicBlogWhere\(new Date\(\)\)/);
    expect(read("lib/growth/summary.ts")).toMatch(/blogPost\.count\(\{ where: publicBlogWhere\(new Date\(\)\) \}\)/);
    for (const file of ["app/page.tsx", "app/(public)/blog/page.tsx", "app/v2/(public)/blog/page.tsx", "app/admin/website/preview/page.tsx"]) {
      const source = read(file);
      expect(source).toMatch(/listPublishedBlogPosts/);
      expect(source).not.toMatch(/blogPost\.findMany/);
    }
    for (const file of ["app/(public)/blog/[slug]/page.tsx", "app/v2/(public)/blog/[slug]/page.tsx"]) {
      expect(read(file)).toMatch(/getPublishedBlogPostBySlug/);
    }
  });

  it("no public blog route is prerendered or cached past a publish time", () => {
    for (const file of ["app/(public)/blog/page.tsx", "app/(public)/blog/[slug]/page.tsx", "app/v2/(public)/blog/page.tsx", "app/v2/(public)/blog/[slug]/page.tsx", "app/sitemap.ts"]) {
      const source = read(file);
      expect(source, file).toMatch(/export const dynamic = "force-dynamic"/);
      expect(source, file).not.toMatch(/generateStaticParams|export const revalidate/);
    }
    // The home page reads cookies (dynamic per request).
    expect(read("app/page.tsx")).toMatch(/getSession\(\)/);
  });
});
