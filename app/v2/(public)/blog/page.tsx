import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, BookOpenText, Calendar, User } from "lucide-react";
import { listPublishedBlogPosts } from "@/lib/public-site/blog";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { notFound } from "next/navigation";

export const metadata = { title: "Blog · sNeek Property Services" };

export default async function V2BlogIndexPage() {
  const posts = await listPublishedBlogPosts().catch(() => []);
  const featuredPost = posts[0] ?? null;
  const otherPosts = posts.slice(1);

  const allTags: string[] = [];
  for (const p of posts) {
    for (const t of (p as any).tags ?? []) {
      if (!allTags.includes(t)) allTags.push(t);
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <EEyebrow className="mb-3">Journal</EEyebrow>
          <h1 className="e-display-xl">Cleaning tips, hosting notes &amp; property advice.</h1>
          <p className="mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
            Practical articles from the sNeek team — turnovers, bond cleans, linen, and keeping properties consistently guest-ready.
          </p>
        </div>
      </div>

      {/* Featured post */}
      {featuredPost && (
        <div className="border-b border-[hsl(var(--e-border))]">
          <div className="mx-auto max-w-6xl px-6 py-10">
            <Link href={`/v2/blog/${(featuredPost as any).slug}`} className="group block">
              <div className="grid overflow-hidden rounded-[var(--e-radius-xl)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-1)] transition-shadow duration-200 group-hover:shadow-[var(--e-elevation-2)] lg:grid-cols-[1fr_420px]">
                <div className="relative min-h-[220px] overflow-hidden lg:min-h-[320px] bg-[hsl(var(--e-surface-raised))]">
                  {(featuredPost as any).coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(featuredPost as any).coverImageUrl}
                      alt={(featuredPost as any).title}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <BookOpenText className="h-16 w-16 text-[hsl(var(--e-primary)/0.2)]" />
                    </div>
                  )}
                  <span className="absolute left-4 top-4 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-primary))] px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.2em] text-[hsl(var(--e-primary-foreground))]">
                    Featured
                  </span>
                </div>
                <div className="flex flex-col justify-center gap-4 p-7">
                  <div className="flex flex-wrap gap-1.5">
                    {((featuredPost as any).tags ?? []).slice(0, 3).map((tag: string) => (
                      <span key={tag} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2.5 py-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{tag}</span>
                    ))}
                  </div>
                  <h2 className="e-display-sm group-hover:text-[hsl(var(--e-gold-ink))] transition-colors duration-150">
                    {(featuredPost as any).title}
                  </h2>
                  <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))] line-clamp-3">
                    {(featuredPost as any).excerpt}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date((featuredPost as any).publishedAt ?? (featuredPost as any).updatedAt), "dd MMM yyyy")}
                    </span>
                    {(featuredPost as any).authorName && (
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {(featuredPost as any).authorName}
                      </span>
                    )}
                  </div>
                  <p className="inline-flex items-center gap-1.5 text-[0.875rem] font-semibold text-[hsl(var(--e-gold-ink))]">
                    Read article <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* All posts */}
      <div className="mx-auto max-w-6xl px-6 py-14">
        {posts.length === 0 ? (
          <ECard>
            <ECardBody className="py-16 text-center pt-6">
              <BookOpenText className="mx-auto mb-4 h-10 w-10 text-[hsl(var(--e-primary)/0.25)]" />
              <p className="font-semibold">No posts yet</p>
              <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Check back soon — articles are on their way.</p>
            </ECardBody>
          </ECard>
        ) : otherPosts.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {otherPosts.map((post: any) => (
              <Link key={post.id} href={`/v2/blog/${post.slug}`} className="group flex flex-col">
                <div className="flex flex-1 flex-col overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]">
                  <div className="relative h-48 overflow-hidden bg-[hsl(var(--e-surface-raised))]">
                    {post.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.coverImageUrl} alt={post.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <BookOpenText className="h-10 w-10 text-[hsl(var(--e-primary)/0.15)]" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    {(post.tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(post.tags as string[]).slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2.5 py-0.5 text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">{tag}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex-1 space-y-1.5">
                      <h2 className="text-[1rem] font-semibold leading-snug group-hover:text-[hsl(var(--e-gold-ink))] transition-colors duration-150">
                        {post.title}
                      </h2>
                      <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))] line-clamp-2">{post.excerpt}</p>
                    </div>
                    <div className="flex items-center justify-between border-t border-[hsl(var(--e-border))] pt-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(post.publishedAt ?? post.updatedAt), "dd MMM yyyy")}
                      </span>
                      <span className="flex items-center gap-1 font-medium text-[hsl(var(--e-gold-ink))]">
                        Read <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
