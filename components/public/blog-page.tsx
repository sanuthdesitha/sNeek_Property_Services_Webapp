"use client";

import Link from "next/link";
import { useState } from "react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowRight, BookOpenText, Calendar, Clock, Tag, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";

const ALL_TAG = "All";

export function BlogIndexPage({ posts }: { readonly posts: any[] }) {
  const featuredPost = posts[0] ?? null;
  const otherPosts = posts.length > 1 ? posts.slice(1) : [];

  // Collect unique tags
  const allTags: string[] = [ALL_TAG];
  for (const p of posts) {
    for (const t of p.tags ?? []) {
      if (!allTags.includes(t)) allTags.push(t);
    }
  }

  const [activeTag, setActiveTag] = useState(ALL_TAG);
  const filtered = activeTag === ALL_TAG
    ? otherPosts
    : otherPosts.filter((p) => (p.tags ?? []).includes(activeTag));

  return (
    <>
      {/* ── PAGE HEADER ── */}
      <div className="border-b border-border/60 bg-white/60 backdrop-blur-sm">
        <div className={`${PUBLIC_PAGE_CONTAINER} py-10 sm:py-14`}>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-primary">Journal</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Cleaning tips, hosting notes &amp; property advice
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            Practical articles from the sNeek team — turnovers, bond cleans, linen, and keeping properties consistently guest-ready.
          </p>
        </div>
      </div>

      {/* ── FEATURED POST ── full-width banner */}
      {featuredPost && (
        <div className="border-b border-border/60">
          <div className={`${PUBLIC_PAGE_CONTAINER} py-8 sm:py-10`}>
            <Link href={`/blog/${featuredPost.slug}`} className="group block">
              <div className="grid gap-6 overflow-hidden rounded-[1.6rem] border border-white/70 bg-white/80 shadow-[0_12px_40px_-20px_rgba(25,67,74,0.28)] transition-shadow duration-300 group-hover:shadow-[0_20px_56px_-24px_rgba(25,67,74,0.38)] lg:grid-cols-[1fr_420px] xl:grid-cols-[1fr_480px]">
                {/* Image */}
                <div className="relative min-h-[220px] overflow-hidden lg:min-h-[320px]">
                  {featuredPost.coverImageUrl ? (
                    <img
                      src={featuredPost.coverImageUrl}
                      alt={featuredPost.title}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-accent/20">
                      <BookOpenText className="h-16 w-16 text-primary/25" />
                    </div>
                  )}
                  {/* "Featured" label overlay */}
                  <span className="absolute left-4 top-4 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground shadow-sm">
                    Featured
                  </span>
                </div>

                {/* Content */}
                <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
                  <div className="flex flex-wrap gap-1.5">
                    {(featuredPost.tags ?? []).slice(0, 4).map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold leading-snug group-hover:text-primary transition-colors duration-200 sm:text-2xl">
                      {featuredPost.title}
                    </h2>
                    <p className="text-sm leading-7 text-muted-foreground line-clamp-3">
                      {featuredPost.excerpt}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(featuredPost.publishedAt ?? featuredPost.updatedAt), "dd MMM yyyy")}
                    </span>
                    {featuredPost.authorName && (
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {featuredPost.authorName}
                      </span>
                    )}
                  </div>
                  <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    Read article <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* ── ALL POSTS ── */}
      <div className={`${PUBLIC_PAGE_CONTAINER} py-10 sm:py-14`}>
        {posts.length === 0 ? (
          <div className="rounded-[1.6rem] border border-border/60 bg-white/70 px-8 py-16 text-center">
            <BookOpenText className="mx-auto mb-4 h-10 w-10 text-primary/30" />
            <p className="font-semibold">No posts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Check back soon — articles are on their way.</p>
          </div>
        ) : (
          <>
            {/* Tag filter strip */}
            {allTags.length > 1 && otherPosts.length > 0 && (
              <div className="mb-8 flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(tag)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                      activeTag === tag
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "border border-border bg-white/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {tag === ALL_TAG ? (
                      tag
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Tag className="h-3 w-3" />
                        {tag}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Grid */}
            {otherPosts.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((post) => (
                  <Link key={post.id} href={`/blog/${post.slug}`} className="group flex flex-col">
                    <article className="flex flex-1 flex-col overflow-hidden rounded-[1.4rem] border border-border/60 bg-white/80 shadow-sm transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[0_12px_36px_-16px_rgba(25,67,74,0.28)]">
                      {/* Thumbnail */}
                      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-primary/8 to-accent/20">
                        {post.coverImageUrl ? (
                          <img
                            src={post.coverImageUrl}
                            alt={post.title}
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <BookOpenText className="h-10 w-10 text-primary/20" />
                          </div>
                        )}
                      </div>

                      {/* Body */}
                      <div className="flex flex-1 flex-col gap-3 p-5">
                        {/* Tags */}
                        {(post.tags ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {(post.tags as string[]).slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Title + excerpt */}
                        <div className="flex-1 space-y-1.5">
                          <h2 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors duration-200">
                            {post.title}
                          </h2>
                          <p className="text-sm leading-6 text-muted-foreground line-clamp-2">{post.excerpt}</p>
                        </div>

                        {/* Meta */}
                        <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(post.publishedAt ?? post.updatedAt), "dd MMM yyyy")}
                          </span>
                          <span className="flex items-center gap-1 font-medium text-primary">
                            Read <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                          </span>
                        </div>
                      </div>
                    </article>
                  </Link>
                ))}
              </div>
            )}

            {filtered.length === 0 && otherPosts.length > 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No articles tagged &ldquo;{activeTag}&rdquo;.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function BlogPostPage({ post }: { readonly post: any }) {
  return (
    <>
      <article className={`${PUBLIC_PAGE_CONTAINER} py-10 sm:py-14`}>
        <div className="mx-auto max-w-3xl">
          {/* Back */}
          <Button asChild variant="ghost" className="mb-8 -ml-2 rounded-full text-muted-foreground">
            <Link href="/blog">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to blog
            </Link>
          </Button>

          {/* Header */}
          <div className="mb-8 space-y-4">
            {(post.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(post.tags as string[]).map((tag: string) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            )}
            <h1 className="text-balance text-3xl font-semibold leading-tight sm:text-4xl">{post.title}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {format(new Date(post.publishedAt ?? post.updatedAt), "dd MMMM yyyy")}
              </span>
              {post.authorName && (
                <span className="flex items-center gap-1.5">
                  <User className="h-4 w-4" />
                  {post.authorName}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {Math.max(1, Math.ceil((post.body?.split(/\s+/).length ?? 0) / 200))} min read
              </span>
            </div>
            {post.excerpt && (
              <p className="text-base leading-8 text-muted-foreground border-l-2 border-primary/40 pl-4">
                {post.excerpt}
              </p>
            )}
          </div>

          {/* Hero image */}
          {post.coverImageUrl && (
            <div className="mb-10 overflow-hidden rounded-[1.6rem] shadow-[0_16px_50px_-24px_rgba(25,67,74,0.32)]">
              <img
                src={post.coverImageUrl}
                alt={post.title}
                className="w-full object-cover"
              />
            </div>
          )}

          {/* Body */}
          <div className="prose prose-slate max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-p:leading-8 prose-p:text-foreground/80 prose-li:text-foreground/80 prose-li:leading-7">
            <ReactMarkdown>{post.body}</ReactMarkdown>
          </div>

          {/* Gallery */}
          {Array.isArray(post.galleryImageUrls) && post.galleryImageUrls.length > 0 && (
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {(post.galleryImageUrls as string[]).map((url, i) => (
                <img
                  key={`${url}-${i}`}
                  src={url}
                  alt={`${post.title} — image ${i + 1}`}
                  className="w-full rounded-[1.2rem] object-cover shadow-sm"
                />
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="mt-12 flex flex-col gap-4 rounded-[1.4rem] border border-primary/20 bg-primary/5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <p className="font-semibold">Ready to book a professional clean?</p>
              <p className="mt-1 text-sm text-muted-foreground">Get an instant estimate in under 2 minutes — no account needed.</p>
            </div>
            <Button asChild className="shrink-0 rounded-full">
              <Link href="/quote">
                Get instant quote
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </article>
    </>
  );
}
