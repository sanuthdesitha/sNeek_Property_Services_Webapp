import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, Calendar, Clock, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { getPublishedBlogPostBySlug, listPublishedBlogPosts } from "@/lib/public-site/blog";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

export async function generateStaticParams() {
  const posts = await listPublishedBlogPosts().catch(() => []);
  return posts.map((p: any) => ({ slug: p.slug }));
}

export default async function V2BlogPostPage({ params }: { params: { slug: string } }) {
  const post = await getPublishedBlogPostBySlug(params.slug).catch(() => null);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-3xl px-6 py-14">
      {/* Back */}
      <EButton asChild variant="ghost" size="sm" className="mb-8 -ml-2">
        <Link href="/v2/blog">
          <ArrowLeft className="h-4 w-4" /> Back to blog
        </Link>
      </EButton>

      {/* Header */}
      <div className="mb-8 space-y-4">
        {((post as any).tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {((post as any).tags as string[]).map((tag) => (
              <span key={tag} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2.5 py-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                {tag}
              </span>
            ))}
          </div>
        )}
        <h1 className="e-display-lg text-balance">{(post as any).title}</h1>
        <div className="flex flex-wrap items-center gap-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            {format(new Date((post as any).publishedAt ?? (post as any).updatedAt), "dd MMMM yyyy")}
          </span>
          {(post as any).authorName && (
            <span className="flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {(post as any).authorName}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            {Math.max(1, Math.ceil(((post as any).body?.split(/\s+/).length ?? 0) / 200))} min read
          </span>
        </div>
        {(post as any).excerpt && (
          <p className="border-l-2 border-[hsl(var(--e-gold))] pl-4 text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
            {(post as any).excerpt}
          </p>
        )}
      </div>

      {/* Hero image */}
      {(post as any).coverImageUrl && (
        <div className="mb-10 overflow-hidden rounded-[var(--e-radius-xl)] shadow-[var(--e-elevation-2)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={(post as any).coverImageUrl} alt={(post as any).title} className="w-full object-cover" />
        </div>
      )}

      {/* Body */}
      <div className="prose prose-slate max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-[hsl(var(--e-gold-ink))] prose-a:no-underline hover:prose-a:underline prose-p:leading-[1.8] prose-p:text-[hsl(var(--e-text-secondary))] prose-li:text-[hsl(var(--e-text-secondary))] prose-li:leading-7">
        <ReactMarkdown>{(post as any).body}</ReactMarkdown>
      </div>

      {/* Gallery */}
      {Array.isArray((post as any).galleryImageUrls) && (post as any).galleryImageUrls.length > 0 && (
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {((post as any).galleryImageUrls as string[]).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={`${url}-${i}`} src={url} alt={`${(post as any).title} — image ${i + 1}`} className="w-full rounded-[var(--e-radius-lg)] object-cover shadow-[var(--e-elevation-1)]" />
          ))}
        </div>
      )}

      {/* CTA */}
      <ECard variant="ceremony" className="mt-12">
        <ECardBody className="pt-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <EEyebrow className="mb-2">Ready to book a professional clean?</EEyebrow>
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              Get an instant estimate in under 2 minutes — no account needed.
            </p>
          </div>
          <EButton asChild variant="gold" className="mt-4 shrink-0 sm:mt-0">
            <Link href="/v2/quote">
              Get instant quote <ArrowRight className="h-4 w-4" />
            </Link>
          </EButton>
        </ECardBody>
      </ECard>
    </article>
  );
}
