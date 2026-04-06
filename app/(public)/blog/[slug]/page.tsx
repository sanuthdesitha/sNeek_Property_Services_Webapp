import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogPostPage } from "@/components/public/blog-page";
import { getPublishedBlogPostBySlug, listPublishedBlogPosts } from "@/lib/public-site/blog";
import { getAppSettings } from "@/lib/settings";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sneekproservices.com.au";

export async function generateStaticParams() {
  const posts = await listPublishedBlogPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getPublishedBlogPostBySlug(params.slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `${SITE_URL}/blog/${post.slug}` },
    openGraph: {
      type: "article",
      url: `${SITE_URL}/blog/${post.slug}`,
      title: post.title,
      description: post.excerpt,
      ...(post.coverImageUrl ? { images: [{ url: post.coverImageUrl }] } : {}),
      publishedTime: post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined,
      modifiedTime: new Date(post.updatedAt).toISOString(),
      authors: [post.authorName ?? "sNeek Property Services"],
    },
  };
}

export default async function PublicBlogPostPage({ params }: { params: { slug: string } }) {
  const settings = await getAppSettings();
  requireWebsitePageEnabled(settings.websiteContent, "blog");
  const post = await getPublishedBlogPostBySlug(params.slug);
  if (!post) notFound();

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    image: post.coverImageUrl ?? undefined,
    datePublished: post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined,
    dateModified: new Date(post.updatedAt).toISOString(),
    author: {
      "@type": "Organization",
      name: post.authorName ?? "sNeek Property Services",
      url: SITE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "sNeek Property Services",
      url: SITE_URL,
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${post.slug}` },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <BlogPostPage post={post} />
    </>
  );
}
